import { z } from "zod";
import { readOptionalEnv } from "../libs/env.utils";
import { addDays, atPragueClock, pragueWeekday, toPragueIso } from "../libs/time.utils";
import type { Profile } from "../profile";
import { fetchParkAndRideStatuses, parkingStatusSchema, type ParkingStatus } from "./parking";
import { planRouteArrivingAt, plannedRouteSchema } from "./tomtom";

const DAYS_TO_SEARCH = 8;
const MS_PER_MINUTE = 60_000;

export const commutePlanSchema = z.object({
  arriveAt: z.string(),
  usualDepartureTime: z.string(),
  options: z.array(
    z.object({ parkAndRide: z.string(), route: plannedRouteSchema, parking: parkingStatusSchema.optional() }),
  ),
});

export type CommutePlan = z.infer<typeof commutePlanSchema>;

export const nextCommuteArrival = (profile: Profile, now: Date): Date => {
  for (let dayOffset = 0; dayOffset < DAYS_TO_SEARCH; dayOffset += 1) {
    const candidate = atPragueClock(addDays(now, dayOffset), profile.commute.arriveAtParkAndRide);
    const isCommuteDay = profile.commute.days.some((day) => day === pragueWeekday(candidate));
    if (candidate > now && isCommuteDay) {
      return candidate;
    }
  }
  throw new Error("Profile has no commute day in the next week");
};

/** P+R occupancy is optional: without a Golemio key the plan still works on travel time alone. */
const readParkingStatuses = async (profile: Profile, arriveAt: Date): Promise<Map<string, ParkingStatus>> => {
  const apiKey = readOptionalEnv("GOLEMIO_API_KEY");
  if (!apiKey) {
    console.warn("GOLEMIO_API_KEY is missing: P+R occupancy skipped");
    return new Map();
  }
  const names = profile.commute.parkAndRideCandidates.map((candidate) => candidate.name);
  return fetchParkAndRideStatuses(apiKey, names, arriveAt);
};

/** Routes to every P+R candidate; the digest picks one using occupancy and travel time. */
export const planCommute = async (profile: Profile, now: Date): Promise<CommutePlan> => {
  const apiKey = readOptionalEnv("TOMTOM_API_KEY");
  if (!apiKey) {
    throw new Error("TOMTOM_API_KEY is missing; the commute plan needs TomTom routing");
  }
  const arriveAt = nextCommuteArrival(profile, now);
  const parkingStatuses = await readParkingStatuses(profile, arriveAt);
  const options: CommutePlan["options"] = [];
  for (const parkAndRide of profile.commute.parkAndRideCandidates) {
    const route = await planRouteArrivingAt(apiKey, profile.home, parkAndRide, arriveAt);
    options.push({ parkAndRide: parkAndRide.name, route, parking: parkingStatuses.get(parkAndRide.name) });
  }
  return {
    arriveAt: toPragueIso(arriveAt),
    usualDepartureTime: toPragueIso(new Date(arriveAt.getTime() - profile.commute.usualDriveMinutes * MS_PER_MINUTE)),
    options,
  };
};
