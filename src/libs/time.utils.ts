const PRAGUE_TIME_ZONE = "Europe/Prague";
const DATE_ONLY_LENGTH = "YYYY-MM-DD".length;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: PRAGUE_TIME_ZONE, timeZoneName: "longOffset" });
const weekdayFormatter = new Intl.DateTimeFormat("en-US", { timeZone: PRAGUE_TIME_ZONE, weekday: "short" });
const dayLabelFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PRAGUE_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});
const dayLabelWithYearFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: PRAGUE_TIME_ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});
const wallClockFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRAGUE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const getPragueOffset = (date: Date): string => {
  const zoneName = offsetFormatter.formatToParts(date).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const offset = zoneName.replace("GMT", "");
  if (offset === "") {
    return "+00:00";
  }
  return offset;
};

// Seconds appear for historical dates (Prague local mean time +00:57:44), which some sources contain as typos.
const parseOffsetMinutes = (offset: string): number => {
  const match = /^([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset);
  if (!match) {
    throw new Error(`Unexpected UTC offset format: ${offset}`);
  }
  const [, sign, hours, minutes, seconds] = match;
  const absoluteMinutes = Number(hours) * 60 + Number(minutes) + Number(seconds ?? 0) / 60;
  return sign === "-" ? -absoluteMinutes : absoluteMinutes;
};

const assertValidDate = (date: Date, raw: string): Date => {
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Unparseable date: ${raw}`);
  }
  return date;
};

export const toPragueIso = (date: Date): string => {
  const parts = Object.fromEntries(wallClockFormatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${getPragueOffset(date)}`;
};

/** Parses Prague wall-clock time without an offset, e.g. "2026-09-27T00:00:00" or "2026-09-29". */
export const parsePragueWallClock = (wallClock: string): Date => {
  const normalized = wallClock.length === DATE_ONLY_LENGTH ? `${wallClock}T00:00:00` : wallClock;
  const asUtc = assertValidDate(new Date(`${normalized}Z`), wallClock);
  const offsetMinutes = parseOffsetMinutes(getPragueOffset(asUtc));
  return new Date(asUtc.getTime() - offsetMinutes * MS_PER_MINUTE);
};

export const parsePragueEndOfDay = (date: string): Date => parsePragueWallClock(`${date}T23:59:59`);

/** GoOut JSON-LD dates are JavaScript Date strings, e.g. "Fri Nov 13 2026 18:00:00 GMT+0000 (Coordinated Universal Time)". */
export const parseJsDateString = (raw: string): Date =>
  assertValidDate(new Date(raw.replace(/\s*\(.*\)\s*$/, "")), raw);

export const parseIsoDate = (raw: string): Date => assertValidDate(new Date(raw), raw);

export const fromUnixSeconds = (seconds: number): Date => new Date(seconds * 1000);

export const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * MS_PER_DAY);

export const pragueToday = (now: Date = new Date()): string => toPragueIso(now).slice(0, DATE_ONLY_LENGTH);

// Czech public holidays with a fixed date (Act No. 245/2000 Coll.), as "MM-DD".
const FIXED_CZECH_PUBLIC_HOLIDAYS = new Set(["01-01", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"]);

/** Easter Sunday at UTC midnight, by the anonymous Gregorian algorithm (Meeus/Jones/Butcher); the letters follow the algorithm. */
const getEasterSunday = (year: number): Date => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const monthAndDay = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(monthAndDay / 31) - 1, (monthAndDay % 31) + 1));
};

/** The fixed-date holidays plus Good Friday and Easter Monday, for the Prague calendar day of `date`. */
export const isCzechPublicHoliday = (date: Date): boolean => {
  const day = pragueToday(date);
  if (FIXED_CZECH_PUBLIC_HOLIDAYS.has(day.slice(5))) {
    return true;
  }
  const easterSunday = getEasterSunday(Number(day.slice(0, 4)));
  return [-2, 1].some((offsetDays) => addDays(easterSunday, offsetDays).toISOString().slice(0, DATE_ONLY_LENGTH) === day);
};

/** Lower-case three-letter weekday in Prague, e.g. "mon". */
export const pragueWeekday = (date: Date): string => weekdayFormatter.format(date).toLowerCase();

/** "HH:MM" in Prague. */
export const pragueClock = (date: Date): string => toPragueIso(date).slice(DATE_ONLY_LENGTH + 1, DATE_ONLY_LENGTH + 6);

export const atPragueClock = (date: Date, clock: string): Date => parsePragueWallClock(`${pragueToday(date)}T${clock}:00`);

const pragueYear = (date: Date): string => pragueToday(date).slice(0, 4);

/** "Mon, 16 Nov", with the year only when it differs from `now`. */
const formatDayLabel = (date: Date, now: Date): string =>
  pragueYear(date) === pragueYear(now) ? dayLabelFormatter.format(date) : dayLabelWithYearFormatter.format(date);

/** "Mon, 16 Nov 2026, 06:30" in Prague. */
export const formatDateTimeLabel = (date: Date): string => `${dayLabelWithYearFormatter.format(date)}, ${pragueClock(date)}`;

/** Computed in code so the LLM never has to guess what "today" is. */
export const relativeDayLabel = (date: Date, now: Date): string => {
  const day = pragueToday(date);
  if (day === pragueToday(now)) {
    return "today";
  }
  if (day === pragueToday(addDays(now, 1))) {
    return "tomorrow";
  }
  return formatDayLabel(date, now);
};

/** Human label for a time range in Prague, e.g. "Mon, 16 Nov, 11:30–15:00", "until Mon, 30 Nov" or "since Fri, 31 Jan 2025". */
export const formatTimeRange = (fromIso: string, toIso: string | undefined, now: Date): string => {
  const from = new Date(fromIso);
  const fromLabel = `${formatDayLabel(from, now)}, ${pragueClock(from)}`;
  if (!toIso) {
    return from <= now ? `since ${formatDayLabel(from, now)}` : fromLabel;
  }
  const to = new Date(toIso);
  if (pragueToday(from) === pragueToday(to)) {
    return `${fromLabel}–${pragueClock(to)}`;
  }
  if (from <= now) {
    return `until ${formatDayLabel(to, now)}`;
  }
  return `${formatDayLabel(from, now)} – ${formatDayLabel(to, now)}`;
};
