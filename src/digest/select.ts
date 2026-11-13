import type { Item } from "../item";
import { truncate } from "../libs/text.utils";
import { formatTimeRange, pragueClock, relativeDayLabel } from "../libs/time.utils";
import type { Candidate } from "../pipeline/filter";
import type { Profile } from "../profile";
import type { CommutePlan } from "../route/commute";
import type { DigestEntry, DigestSection } from "./schema";

const SECONDS_PER_MINUTE = 60;
const MS_PER_MINUTE = 60_000;
const DETAILS_MAX_LENGTH = 220;
const COMMUTE_ENTRY_REF = 1;
// A count measured further from the digest time (e.g. a digest rendered --as-of another day) is not "now".
const FRESH_MEASUREMENT_MINUTES = 60;

export interface NoticeSummary {
  summary: string;
  affectsResidents: boolean;
}

interface SelectionInput {
  profile: Profile;
  commute: CommutePlan;
  candidates: readonly Candidate[];
  noticeSummaries: Readonly<Record<string, NoticeSummary>>;
  seenIds: ReadonlySet<string>;
  now: Date;
}

interface SelectionGroup {
  section: DigestSection;
  limit: number;
  matches: (candidate: Candidate) => boolean;
  rank?: (a: Candidate, b: Candidate) => number;
  skipSeen?: boolean;
}

const byStart = (a: Candidate, b: Candidate): number =>
  (a.item.timeRange?.from ?? "").localeCompare(b.item.timeRange?.from ?? "");

const isLineMatch = (candidate: Candidate): boolean => candidate.reason.startsWith("Affects line");

const SELECTION_GROUPS: readonly SelectionGroup[] = [
  { section: "commute", limit: 4, matches: ({ item }) => item.type === "closure", rank: byStart },
  {
    section: "commute",
    limit: 4,
    matches: ({ item }) => item.type === "transit",
    rank: (a, b) => Number(isLineMatch(b)) - Number(isLineMatch(a)) || byStart(a, b),
  },
  {
    section: "home",
    limit: 3,
    matches: ({ item }) => item.type === "outage",
    rank: (a, b) => Number(b.item.tags?.includes("home")) - Number(a.item.tags?.includes("home")) || byStart(a, b),
  },
  { section: "town", limit: 4, matches: ({ item }) => item.type === "notice", rank: (a, b) => -byStart(a, b), skipSeen: true },
  { section: "events", limit: 2, matches: ({ item }) => item.source === "biooko", rank: byStart, skipSeen: true },
  { section: "events", limit: 3, matches: ({ item }) => item.source === "goout", rank: byStart, skipSeen: true },
];

type CommuteOption = CommutePlan["options"][number];

const MIN_USUAL_FREE_SPOTS = 15;

/** Unknown occupancy counts as "has room": missing data must not exclude a P+R. */
const hasRoomAtArrival = (option: CommuteOption): boolean => {
  const usualFree = option.parking?.usualFreeAtArrival;
  return usualFree === undefined || usualFree >= MIN_USUAL_FREE_SPOTS;
};

/** The fastest P+R that usually still has free spaces at arrival time; the fastest one if none does. */
export const chooseCommuteOption = (commute: CommutePlan): CommuteOption | undefined => {
  const byTravelTime = [...commute.options].sort((a, b) => a.route.travelTimeSeconds - b.route.travelTimeSeconds);
  return byTravelTime.find(hasRoomAtArrival) ?? byTravelTime[0];
};

const isFreshMeasurement = (updatedAt: string, now: Date): boolean =>
  Math.abs(now.getTime() - new Date(updatedAt).getTime()) <= FRESH_MEASUREMENT_MINUTES * MS_PER_MINUTE;

const describeParking = (option: CommuteOption, arrivalClock: string, now: Date): string | undefined => {
  if (!option.parking) {
    return undefined;
  }
  const { freeNow, totalSpots, updatedAt, usualFreeAtArrival } = option.parking;
  const current = isFreshMeasurement(updatedAt, now) ? `${freeNow} of ${totalSpots} spaces free now` : `${totalSpots} spaces`;
  const usual = usualFreeAtArrival === undefined ? "" : `, usually ~${usualFreeAtArrival} free at ${arrivalClock} on this weekday`;
  return `${current}${usual}`;
};

const describeOption = (option: CommuteOption, arrivalClock: string, now: Date): string => {
  const parking = describeParking(option, arrivalClock, now);
  const drive = `leave ${pragueClock(new Date(option.route.departureTime))} (${toMinutes(option.route.travelTimeSeconds)} min)`;
  return `${option.parkAndRide}: ${drive}${parking ? `, ${parking}` : ""}`;
};

const buildDirectionsUrl = (profile: Profile, parkAndRideName: string): string => {
  const destination = profile.commute.parkAndRideCandidates.find((candidate) => candidate.name === parkAndRideName);
  const params = new URLSearchParams({
    api: "1",
    origin: `${profile.home.lat},${profile.home.lon}`,
    destination: destination ? `${destination.lat},${destination.lon}` : parkAndRideName,
    travelmode: "driving",
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

const toMinutes = (seconds: number): number => Math.round(seconds / SECONDS_PER_MINUTE);

/** Computed in code from the displayed HH:MM values, so the LLM never does this arithmetic. */
const describeDepartureComparison = (departure: Date, usualDeparture: Date): string => {
  const minutesEarlier = Math.floor(usualDeparture.getTime() / MS_PER_MINUTE) - Math.floor(departure.getTime() / MS_PER_MINUTE);
  const usualClock = pragueClock(usualDeparture);
  if (minutesEarlier === 0) {
    return `at your usual ${usualClock}`;
  }
  const minutes = Math.abs(minutesEarlier);
  const amount = `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${amount} ${minutesEarlier > 0 ? "earlier" : "later"} than your usual ${usualClock}`;
};

const describeDay = (item: Item, now: Date): string | undefined => {
  if (!item.timeRange) {
    return undefined;
  }
  const start = new Date(item.timeRange.from);
  return start <= now ? "ongoing" : relativeDayLabel(start, now);
};

const buildCommuteEntry = (profile: Profile, commute: CommutePlan, now: Date): DigestEntry | undefined => {
  const chosen = chooseCommuteOption(commute);
  if (!chosen) {
    return undefined;
  }
  const { route, parkAndRide } = chosen;
  const arrivalClock = pragueClock(new Date(commute.arriveAt));
  const fastest = [...commute.options].sort((a, b) => a.route.travelTimeSeconds - b.route.travelTimeSeconds)[0];
  const skippedFastest =
    fastest && fastest.parkAndRide !== parkAndRide
      ? `; the faster ${fastest.parkAndRide} usually has only ~${fastest.parking?.usualFreeAtArrival ?? 0} free spaces at ${arrivalClock}`
      : "";
  const chosenParking = describeParking(chosen, arrivalClock, now);
  const alternatives = commute.options
    .filter((option) => option.parkAndRide !== parkAndRide)
    .map((option) => `alternative ${describeOption(option, arrivalClock, now)}`);
  const departure = new Date(route.departureTime);
  const comparison = describeDepartureComparison(departure, new Date(commute.usualDepartureTime));
  return {
    ref: COMMUTE_ENTRY_REF,
    section: "commute",
    itemId: `commute:${commute.arriveAt}`,
    title: `Drive to ${parkAndRide}`,
    day: relativeDayLabel(new Date(route.departureTime), now),
    when: formatTimeRange(route.departureTime, route.arrivalTime, now),
    reason: `Leave at ${pragueClock(departure)} to reach ${parkAndRide} by ${arrivalClock}, ${comparison}${skippedFastest}`,
    details: [
      `${toMinutes(route.travelTimeSeconds)} min, ${(route.lengthMeters / 1000).toFixed(1)} km, traffic delay ${toMinutes(route.trafficDelaySeconds)} min`,
      ...(chosenParking ? [`${parkAndRide} ${chosenParking}`] : []),
      ...alternatives,
    ].join("; "),
    url: buildDirectionsUrl(profile, parkAndRide),
    source: "tomtom",
    confidence: "inferred",
    isNew: true,
  };
};

const buildDetails = (item: Item): string | undefined => {
  const parts = [item.evidence, item.actionHint].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? truncate(parts.join(" | "), DETAILS_MAX_LENGTH) : undefined;
};

/** For notice-board items the time range is the posting period, not the duration of the works. */
const describeWhen = (item: Item, now: Date): string | undefined => {
  if (!item.timeRange) {
    return undefined;
  }
  // PID feed start dates can predate a change by years (Florenc C: 2022 in the feed, 31 Jan 2025 in its text), and
  // the dates in the text often belong to later stages, so an ongoing open-ended change gets no "since" date.
  if (item.source === "pid" && !item.timeRange.to && new Date(item.timeRange.from) <= now) {
    return undefined;
  }
  const range = formatTimeRange(item.timeRange.from, item.timeRange.to, now);
  return item.type === "notice" ? `notice posted ${range}` : range;
};

const toEntry = (candidate: Candidate, section: DigestSection, ref: number, input: SelectionInput): DigestEntry => {
  const { item, reason } = candidate;
  return {
    ref,
    section,
    itemId: item.id,
    title: item.title,
    summary: input.noticeSummaries[item.id]?.summary ?? item.summary,
    day: describeDay(item, input.now),
    when: describeWhen(item, input.now),
    reason,
    details: buildDetails(item),
    url: item.url,
    source: item.source,
    confidence: item.confidence,
    isNew: !input.seenIds.has(item.id),
  };
};

const isRelevantNotice = (candidate: Candidate, input: SelectionInput): boolean =>
  candidate.item.type !== "notice" || input.noticeSummaries[candidate.item.id]?.affectsResidents === true;

/** Deterministic selection: the LLM only writes about what these rules let through. */
export const selectDigestEntries = (input: SelectionInput): DigestEntry[] => {
  const commuteEntry = buildCommuteEntry(input.profile, input.commute, input.now);
  const entries: DigestEntry[] = commuteEntry ? [commuteEntry] : [];
  SELECTION_GROUPS.forEach((group) => {
    const selected = input.candidates
      .filter((candidate) => group.matches(candidate) && isRelevantNotice(candidate, input))
      .filter((candidate) => !group.skipSeen || !input.seenIds.has(candidate.item.id))
      .sort(group.rank)
      .slice(0, group.limit);
    selected.forEach((candidate) => entries.push(toEntry(candidate, group.section, entries.length + 1, input)));
  });
  return entries;
};
