import { join } from "node:path";
import { z } from "zod";
import { readThroughFileCache } from "../libs/cache.utils";
import { fetchJson } from "../libs/http.utils";
import { pragueClock, pragueWeekday, toPragueIso, parseIsoDate } from "../libs/time.utils";
import { DATA_DIR } from "../pipeline/paths";

const API_BASE_URL = "https://api.golemio.cz";
const CACHE_DIR = join(DATA_DIR, "golemio-cache");
const MS_PER_SECOND = 1000;
// Documented Golemio limit.
const RATE_LIMIT_REQUESTS = 20;
const RATE_LIMIT_WINDOW_MS = 8 * MS_PER_SECOND;
// average-occupancy is keyed by JavaScript weekday index; "0" has the flat weekend profile of a Sunday.
const WEEKDAY_INDEX: Readonly<Record<string, string>> = { sun: "0", mon: "1", tue: "2", wed: "3", thu: "4", fri: "5", sat: "6" };

const measurementsSchema = z.array(
  z.object({ total_spot_number: z.number(), free_spot_number: z.number(), last_updated: z.string() }),
);
/** Average occupied spots by weekday index and two-digit hour. */
const averageOccupancySchema = z.record(z.string(), z.record(z.string(), z.number()));

export const parkingStatusSchema = z.object({
  totalSpots: z.number(),
  freeNow: z.number(),
  updatedAt: z.string(),
  usualFreeAtArrival: z.number().optional(),
});

export type ParkingStatus = z.infer<typeof parkingStatusSchema>;

/** Golemio's terms forbid repeating identical calls; each TTL is the `s-maxage` of the endpoint's Cache-Control header. */
export const GOLEMIO_CACHE_TTL_MS = {
  parkings: 300 * MS_PER_SECOND,
  measurements: 60 * MS_PER_SECOND,
  averageOccupancy: 28_800 * MS_PER_SECOND,
  tariffs: 43_200 * MS_PER_SECOND,
} as const;

const recentRequestTimes: number[] = [];

const waitForRateLimit = async (): Promise<void> => {
  for (;;) {
    const now = Date.now();
    while (recentRequestTimes.length > 0 && now - (recentRequestTimes[0] ?? now) >= RATE_LIMIT_WINDOW_MS) {
      recentRequestTimes.shift();
    }
    if (recentRequestTimes.length < RATE_LIMIT_REQUESTS) {
      recentRequestTimes.push(now);
      return;
    }
    const oldestRequestTime = recentRequestTimes[0] ?? now;
    await new Promise((resolve) => setTimeout(resolve, RATE_LIMIT_WINDOW_MS - (now - oldestRequestTime)));
  }
};

/** Cached in `data/golemio-cache/`; the API key is not part of the cache key. */
export const fetchGolemio = (apiKey: string, path: string, cacheTtlMs: number): Promise<unknown> =>
  readThroughFileCache(CACHE_DIR, path, cacheTtlMs, async () => {
    await waitForRateLimit();
    return fetchJson(`${API_BASE_URL}${path}`, { headers: { "X-Access-Token": apiKey } });
  });

/** Free spaces implied by an average occupancy, which can exceed the current capacity. */
export const toUsualFreeSpots = (totalSpots: number, usualOccupied: number): number => Math.max(0, Math.round(totalSpots - usualOccupied));

export interface SingleParkingStatus extends ParkingStatus {
  usualOccupiedAtArrival?: number;
}

export const fetchSingleParkingStatus = async (apiKey: string, parkingId: string, arriveAt: Date): Promise<SingleParkingStatus> => {
  const encodedId = encodeURIComponent(parkingId);
  const [latest] = measurementsSchema.parse(
    await fetchGolemio(apiKey, `/v3/parking-measurements?parkingId[]=${encodedId}&limit=1`, GOLEMIO_CACHE_TTL_MS.measurements),
  );
  if (!latest) {
    throw new Error(`Golemio has no occupancy measurement for ${parkingId}`);
  }
  const averages = averageOccupancySchema.parse(
    await fetchGolemio(apiKey, `/v3/parking/${encodedId}/average-occupancy`, GOLEMIO_CACHE_TTL_MS.averageOccupancy),
  );
  const weekdayIndex = WEEKDAY_INDEX[pragueWeekday(arriveAt)] ?? "";
  const hour = pragueClock(arriveAt).slice(0, 2);
  return {
    totalSpots: latest.total_spot_number,
    freeNow: latest.free_spot_number,
    updatedAt: toPragueIso(parseIsoDate(latest.last_updated)),
    usualOccupiedAtArrival: averages[weekdayIndex]?.[hour],
  };
};
