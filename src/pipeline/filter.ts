import type { Item, LonLat } from "../item";
import { distanceToPolylineMeters, polylinesDistanceMeters } from "../libs/geo.utils";
import { addDays, pragueClock, pragueWeekday } from "../libs/time.utils";
import type { Profile } from "../profile";

export interface Candidate {
  item: Item;
  reason: string;
}

export interface CommuteRoute {
  parkAndRide: string;
  polyline: LonLat[];
}

interface FilterContext {
  profile: Profile;
  now: Date;
  routes: readonly CommuteRoute[];
}

const WEEKEND_DAYS = new Set(["sat", "sun"]);

/** Items without an end are open-ended (notices, closures), except events which end when they start. */
const isWithinWindow = (item: Item, windowStart: Date, windowEnd: Date): boolean => {
  if (!item.timeRange) {
    return true;
  }
  const start = new Date(item.timeRange.from);
  if (start > windowEnd) {
    return false;
  }
  if (!item.timeRange.to) {
    return item.type !== "event" || start >= windowStart;
  }
  return new Date(item.timeRange.to) >= windowStart;
};

const distanceToRouteMeters = (item: Item, route: LonLat[]): number | undefined => {
  const line = item.geo?.line;
  if (line && line.length > 0) {
    return polylinesDistanceMeters(line, route);
  }
  const lat = item.geo?.lat;
  const lon = item.geo?.lon;
  if (lat === undefined || lon === undefined) {
    return undefined;
  }
  return distanceToPolylineMeters([lon, lat], route);
};

const matchClosure = (item: Item, { profile, routes }: FilterContext): string | undefined => {
  const nearest = routes
    .map((route) => ({ parkAndRide: route.parkAndRide, distance: distanceToRouteMeters(item, route.polyline) }))
    .filter((match): match is { parkAndRide: string; distance: number } => match.distance !== undefined)
    .sort((a, b) => a.distance - b.distance)[0];
  if (!nearest || nearest.distance > profile.commute.routeCorridorMeters) {
    return undefined;
  }
  return `On your drive to ${nearest.parkAndRide} (${Math.round(nearest.distance)} m from the route)`;
};

const matchTransit = (item: Item, profile: Profile): string | undefined => {
  const affectedLines = (item.tags ?? []).filter((line) => profile.commute.transitLines.includes(line));
  if (affectedLines.length > 0) {
    return `Affects line ${affectedLines.join(", ")} on your commute`;
  }
  const text = `${item.title} ${item.evidence ?? ""}`.toLocaleLowerCase("cs");
  const keyword = profile.commute.transitKeywords.find((candidate) => text.includes(candidate.toLocaleLowerCase("cs")));
  return keyword ? `Public transport change mentioning ${keyword}` : undefined;
};

const matchOutage = (item: Item): string => {
  if (item.tags?.includes("home")) {
    return "Planned outage at your address";
  }
  return `Planned outage elsewhere in ${item.geo?.municipality ?? "your town"}`;
};

const matchEvent = (item: Item, profile: Profile): string | undefined => {
  if (!item.timeRange) {
    return undefined;
  }
  const start = new Date(item.timeRange.from);
  const isEvening = pragueClock(start) >= profile.events.eveningFrom;
  const isWeekend = WEEKEND_DAYS.has(pragueWeekday(start));
  const place = item.geo?.municipality ?? profile.home.municipality;
  if (item.source === "biooko") {
    return isEvening && !isWeekend ? "Evening screening near your office" : undefined;
  }
  if (isWeekend) {
    return `Weekend in ${place}`;
  }
  return isEvening ? `Evening in ${place}` : undefined;
};

const matchNotice = (item: Item, profile: Profile): string =>
  `${profile.home.municipality} notice board: ${(item.tags ?? []).join(", ")}`;

const matchReason = (item: Item, context: FilterContext): string | undefined => {
  switch (item.type) {
    case "closure":
      return matchClosure(item, context);
    case "transit":
      return matchTransit(item, context.profile);
    case "outage":
      return matchOutage(item);
    case "event":
      return matchEvent(item, context.profile);
    case "notice":
      return matchNotice(item, context.profile);
    default:
      return undefined;
  }
};

/** Hard filters (time window, route corridor, lines, home address) before any LLM sees the data. */
export const selectCandidates = (items: readonly Item[], context: FilterContext): Candidate[] => {
  const windowEnd = addDays(context.now, context.profile.horizonDays);
  return items.flatMap((item) => {
    if (!isWithinWindow(item, context.now, windowEnd)) {
      return [];
    }
    const reason = matchReason(item, context);
    return reason ? [{ item, reason }] : [];
  });
};
