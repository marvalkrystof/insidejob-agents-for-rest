import { z } from "zod";
import { isCzechPublicHoliday, parseIsoDate, pragueClock, pragueWeekday } from "../libs/time.utils";
import { fetchGolemio, GOLEMIO_CACHE_TTL_MS } from "../route/parking";
import type { Confidence } from "./confidence";

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const MS_PER_MINUTE = SECONDS_PER_MINUTE * MS_PER_SECOND;
const WEEKDAYS = ["mo", "tu", "we", "th", "fr", "sa", "su"] as const;
const WEEKDAY_LABELS: Readonly<Record<string, string>> = {
  mo: "Mon",
  tu: "Tue",
  we: "Wed",
  th: "Thu",
  fr: "Fri",
  sa: "Sat",
  su: "Sun",
};
const HOLIDAY_RULE_LABELS: Readonly<Record<string, string>> = {
  any: "",
  ph_off: " except public holidays",
  ph_only: " on public holidays only",
};

const periodSchema = z.object({ day_in_week: z.string(), start: z.string(), end: z.string(), ph: z.string().nullish() });
const chargeSchema = z.object({
  charge: z.coerce.number(),
  charge_type: z.string().nullish(),
  charge_order_index: z.number(),
  charge_interval: z.number().nullish(),
  max_iterations_of_charge: z.number().nullish(),
  min_iterations_of_charge: z.number().nullish(),
  periods_of_time: z.array(periodSchema).nullish(),
});
const chargeBandSchema = z.object({
  maximum_duration: z.number().nullish(),
  valid_from: z.string().nullish(),
  valid_to: z.string().nullish(),
  payment_methods: z.array(z.string()).nullish(),
  charges: z.array(chargeSchema),
});
const tariffSchema = z.object({ id: z.string(), charge_bands: z.array(chargeBandSchema) });

export type Tariff = z.infer<typeof tariffSchema>;
type ChargeBand = z.infer<typeof chargeBandSchema>;
type Charge = z.infer<typeof chargeSchema>;
type Period = z.infer<typeof periodSchema>;
type ChargeKind = "rate" | "maximum" | "minimum";

interface Moment {
  weekday: string;
  minuteOfDay: number;
  isHoliday: boolean;
}

export interface StayCost {
  costCzk: number;
  billedMinutes: number;
  maxStayMinutes?: number;
  fitsStay: boolean;
  uncoveredMinutes: number;
  confidence: Confidence;
  notes: string[];
}

export interface TariffOption {
  rates: string[];
  maxStayMinutes?: number;
  paymentMethods?: string[];
}

export const fetchTariffsById = async (apiKey: string): Promise<Map<string, Tariff>> => {
  const tariffs = z
    .array(tariffSchema)
    .parse(await fetchGolemio(apiKey, "/v3/parking-tariffs?limit=10000", GOLEMIO_CACHE_TTL_MS.tariffs));
  return new Map(tariffs.map((tariff) => [tariff.id, tariff]));
};

const roundCzk = (amount: number): number => Math.round(amount * 100) / 100;

const formatCzk = (amount: number): string => `${roundCzk(amount)} CZK`;

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const restMinutes = Math.round(minutes % MINUTES_PER_HOUR);
  if (hours === 0) {
    return `${restMinutes} min`;
  }
  return restMinutes === 0 ? `${hours} h` : `${hours} h ${restMinutes} min`;
};

/** "08:00" or "08:00:00" → minutes since midnight. */
const toMinuteOfDay = (clock: string): number => Number(clock.slice(0, 2)) * MINUTES_PER_HOUR + Number(clock.slice(3, 5));

const describeMoment = (date: Date): Moment => ({
  weekday: pragueWeekday(date).slice(0, 2),
  minuteOfDay: toMinuteOfDay(pragueClock(date)),
  isHoliday: isCzechPublicHoliday(date),
});

const periodCovers = (period: Period, moment: Moment): boolean => {
  if (period.day_in_week.toLowerCase() !== moment.weekday) {
    return false;
  }
  // Golemio spells the public holiday flag both "PH_only" and "ph_only".
  const holidayRule = period.ph?.toLowerCase();
  if ((holidayRule === "ph_only" && !moment.isHoliday) || (holidayRule === "ph_off" && moment.isHoliday)) {
    return false;
  }
  return toMinuteOfDay(period.start) <= moment.minuteOfDay && moment.minuteOfDay <= toMinuteOfDay(period.end);
};

// A charge without periods applies at any time.
const chargeCovers = (charge: Charge, moment: Moment): boolean =>
  !charge.periods_of_time?.length || charge.periods_of_time.some((period) => periodCovers(period, moment));

const getChargeKind = (charge: Charge): ChargeKind => {
  const type = charge.charge_type?.toLowerCase();
  // "maxiumum" is a typo that occurs in Golemio's data.
  if (type === "maximum" || type === "maxiumum") {
    return "maximum";
  }
  if (type === "minimum") {
    return "minimum";
  }
  return "rate";
};

const byOrderIndex = (first: Charge, second: Charge): number => first.charge_order_index - second.charge_order_index;

const isBandValidAt = (band: ChargeBand, date: Date): boolean =>
  (!band.valid_from || parseIsoDate(band.valid_from) <= date) && (!band.valid_to || date <= parseIsoDate(band.valid_to));

const getMaxStayMinutes = (band: ChargeBand): number | undefined =>
  band.maximum_duration ? band.maximum_duration / SECONDS_PER_MINUTE : undefined;

/**
 * Walks the stay from arrival: each step pays the first rate (by order index) that covers the moment and has
 * iterations left, then minimum iterations, caps and floors apply. Minutes that no rate covers are counted, not priced.
 */
const calculateBandCost = (band: ChargeBand, arriveAt: Date, durationMinutes: number): StayCost => {
  const maxStayMinutes = getMaxStayMinutes(band);
  const fitsStay = maxStayMinutes === undefined || durationMinutes <= maxStayMinutes;
  const billedMinutes = Math.min(durationMinutes, maxStayMinutes ?? durationMinutes);
  const rates = band.charges.filter((charge) => getChargeKind(charge) === "rate").sort(byOrderIndex);
  const iterationsByCharge = new Map<Charge, number>();
  const endMs = arriveAt.getTime() + billedMinutes * MS_PER_MINUTE;
  let total = 0;
  let uncoveredMinutes = 0;
  let cursorMs = arriveAt.getTime();
  while (cursorMs < endMs) {
    const moment = describeMoment(new Date(cursorMs));
    const rate = rates.find((charge) => {
      const hasIterationsLeft = (iterationsByCharge.get(charge) ?? 0) < (charge.max_iterations_of_charge ?? Number.POSITIVE_INFINITY);
      return hasIterationsLeft && chargeCovers(charge, moment);
    });
    if (!rate) {
      uncoveredMinutes += 1;
      cursorMs += MS_PER_MINUTE;
      continue;
    }
    iterationsByCharge.set(rate, (iterationsByCharge.get(rate) ?? 0) + 1);
    total += rate.charge;
    if (!rate.charge_interval) {
      // Without an interval the charge covers the rest of the stay; only free entries have this shape in the data.
      break;
    }
    cursorMs += rate.charge_interval * MS_PER_SECOND;
  }
  iterationsByCharge.forEach((iterations, charge) => {
    total += Math.max(0, (charge.min_iterations_of_charge ?? 0) - iterations) * charge.charge;
  });
  const arrival = describeMoment(arriveAt);
  const amountsAtArrival = (kind: ChargeKind): number[] =>
    band.charges.filter((charge) => getChargeKind(charge) === kind && chargeCovers(charge, arrival)).map(({ charge }) => charge);
  const maximums = amountsAtArrival("maximum");
  const minimums = amountsAtArrival("minimum");
  if (maximums.length > 0) {
    total = Math.min(total, ...maximums);
  }
  if (minimums.length > 0 && total > 0) {
    total = Math.max(total, ...minimums);
  }
  const notes: string[] = [];
  if (uncoveredMinutes > 0) {
    notes.push(
      `No charge in the tariff covers ${formatDuration(uncoveredMinutes)} of the stay; the data does not say whether parking is free or not allowed then`,
    );
  }
  if (!fitsStay && maxStayMinutes !== undefined) {
    notes.push(`Maximum stay is ${formatDuration(maxStayMinutes)}, so the price covers ${formatDuration(billedMinutes)} only`);
  }
  return {
    costCzk: roundCzk(total),
    billedMinutes,
    maxStayMinutes,
    fitsStay,
    uncoveredMinutes,
    confidence: uncoveredMinutes > 0 || !fitsStay ? "estimate" : "live",
    notes,
  };
};

/**
 * The cheapest charge band (alternative product, e.g. hourly vs. day pass) valid at arrival, preferring bands that
 * price every minute of the stay and allow its length. `undefined` when no band is valid at arrival.
 */
export const calculateStayCost = (tariff: Tariff, arriveAt: Date, durationMinutes: number): StayCost | undefined => {
  const [best] = tariff.charge_bands
    .filter((band) => isBandValidAt(band, arriveAt))
    .map((band) => calculateBandCost(band, arriveAt, durationMinutes))
    .sort(
      (first, second) =>
        first.uncoveredMinutes - second.uncoveredMinutes ||
        Number(second.fitsStay) - Number(first.fitsStay) ||
        first.costCzk - second.costCzk,
    );
  if (!best) {
    return undefined;
  }
  if (isCzechPublicHoliday(arriveAt)) {
    best.notes.push("The arrival day is a Czech public holiday");
  }
  return best;
};

const describeInterval = (seconds: number): string => {
  if (seconds === SECONDS_PER_MINUTE) {
    return "minute";
  }
  if (seconds === SECONDS_PER_HOUR) {
    return "hour";
  }
  return formatDuration(seconds / SECONDS_PER_MINUTE);
};

/** "Mon–Fri", "daily" or "Sat, Sun". */
const describeDays = (days: readonly string[]): string => {
  const indexes = WEEKDAYS.flatMap((weekday, index) => (days.includes(weekday) ? [index] : []));
  if (indexes.length === WEEKDAYS.length) {
    return "daily";
  }
  const isContiguous = indexes.every((value, position) => position === 0 || value === (indexes[position - 1] ?? value) + 1);
  const labels = indexes.map((index) => WEEKDAY_LABELS[WEEKDAYS[index] ?? ""] ?? "");
  if (isContiguous && labels.length > 2) {
    return `${labels[0]}–${labels[labels.length - 1]}`;
  }
  return labels.join(", ");
};

/** Groups periods by time window; a day listed both with and without holidays applies on holidays too. */
const describePeriods = (periods: readonly Period[]): string => {
  if (periods.length === 0) {
    return "at any time";
  }
  const daysByRuleByWindow = new Map<string, Map<string, Set<string>>>();
  periods.forEach(({ day_in_week: day, start, end, ph }) => {
    const window = `${start.slice(0, 5)}–${end.slice(0, 5)}`;
    const rule = ph?.toLowerCase() ?? "any";
    const daysByRule = daysByRuleByWindow.get(window) ?? new Map<string, Set<string>>();
    daysByRule.set(rule, (daysByRule.get(rule) ?? new Set<string>()).add(day.toLowerCase()));
    daysByRuleByWindow.set(window, daysByRule);
  });
  return [...daysByRuleByWindow]
    .flatMap(([window, daysByRule]) => {
      const offDays = [...(daysByRule.get("ph_off") ?? [])];
      const onlyDays = [...(daysByRule.get("ph_only") ?? [])];
      const anyDays = new Set([...(daysByRule.get("any") ?? []), ...offDays.filter((day) => onlyDays.includes(day))]);
      const daysPerRule: [string, string[]][] = [
        ["any", [...anyDays]],
        ["ph_off", offDays.filter((day) => !anyDays.has(day))],
        ["ph_only", onlyDays.filter((day) => !anyDays.has(day))],
      ];
      return daysPerRule
        .filter(([, days]) => days.length > 0)
        .map(([rule, days]) => `${describeDays(days)} ${window}${HOLIDAY_RULE_LABELS[rule] ?? ""}`);
    })
    .join("; ");
};

const describeCharge = (charge: Charge): string => {
  const when = describePeriods(charge.periods_of_time ?? []);
  const kind = getChargeKind(charge);
  if (kind === "maximum") {
    return `at most ${formatCzk(charge.charge)} per stay, ${when}`;
  }
  if (kind === "minimum") {
    return `at least ${formatCzk(charge.charge)} per stay, ${when}`;
  }
  const interval = charge.charge_interval;
  if (!interval) {
    return `${formatCzk(charge.charge)} for the stay, ${when}`;
  }
  const hourlyRate = interval < SECONDS_PER_HOUR ? ` (${formatCzk((charge.charge * SECONDS_PER_HOUR) / interval)}/h)` : "";
  const minimumMinutes = ((charge.min_iterations_of_charge ?? 0) * interval) / SECONDS_PER_MINUTE;
  const maximumMinutes = ((charge.max_iterations_of_charge ?? 0) * interval) / SECONDS_PER_MINUTE;
  // Limits of a day or more ("1440 × 1 min") only restate the day; shorter ones mark a sequence ("first hour free").
  const limits = [
    minimumMinutes > interval / SECONDS_PER_MINUTE ? `at least ${formatDuration(minimumMinutes)}` : undefined,
    maximumMinutes > 0 && maximumMinutes < MINUTES_PER_DAY ? `for the first ${formatDuration(maximumMinutes)}` : undefined,
  ].filter(Boolean);
  const limitsText = limits.length > 0 ? `, ${limits.join(", ")}` : "";
  return `${formatCzk(charge.charge)} per ${describeInterval(interval)}${hourlyRate}${limitsText}, ${when}`;
};

/** The charge bands valid at `at` in plain words; several bands are alternative products (hourly, day pass, weekend). */
export const describeTariffOptions = (tariff: Tariff, at: Date): TariffOption[] =>
  tariff.charge_bands
    .filter((band) => isBandValidAt(band, at))
    .map((band) => ({
      rates: [...band.charges].sort(byOrderIndex).map(describeCharge),
      maxStayMinutes: getMaxStayMinutes(band),
      paymentMethods: band.payment_methods?.length ? band.payment_methods : undefined,
    }));
