import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { loadEnvFileIfPresent, requireEnv } from "../libs/env.utils";
import { describeError } from "../libs/error.utils";
import { isCzechPublicHoliday, parseIsoDate, toPragueIso } from "../libs/time.utils";
import { fetchSingleParkingStatus, toUsualFreeSpots, type SingleParkingStatus } from "../route/parking";
import type { Confidence } from "./confidence";
import { fetchParkingById, fetchParkingNear, PARKING_KINDS, type NearbyParkingPlace, type ParkingPlace } from "./parking-places";
import { calculateStayCost, describeTariffOptions, fetchTariffsById, type StayCost, type Tariff } from "./parking-tariff";

const SERVER_NAME = "domovnik-parking";
const SERVER_VERSION = "0.1.0";
const LOG_PREFIX = "[parking-mcp]";
const MS_PER_MINUTE = 60_000;
// An arrival this close to now is answered with the current measurement; later arrivals with the usual occupancy.
const LIVE_ARRIVAL_WINDOW_MS = 30 * MS_PER_MINUTE;
const MAX_STAY_MINUTES = 24 * 60;
const DEFAULT_MAX_WALK_METERS = 1000;
const DEFAULT_RESULT_LIMIT = 8;
const REQUIREMENTS = ["disabled", "ev_charging"] as const;
const READ_ONLY_TOOL = { readOnlyHint: true, openWorldHint: true } as const;
const NO_TARIFF_NOTE = "Golemio has no tariff for this place";
const NO_VALID_BAND_NOTE = "The tariff has no charge band valid at the arrival time";

type Requirement = (typeof REQUIREMENTS)[number];

interface UnknownPrice {
  confidence: Confidence;
  note: string;
}

interface Availability {
  freeSpots?: number;
  totalSpots?: number;
  updatedAt?: string;
  confidence: Confidence;
  note?: string;
}

const OFFSET_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
// A refinement instead of z.string().datetime(), whose JSON Schema regex would add ~600 characters per field to every LLM call.
const isoDateTimeSchema = z
  .string()
  .refine((value) => OFFSET_DATE_TIME_PATTERN.test(value) && !Number.isNaN(Date.parse(value)), "Expected ISO 8601 with an offset");
const parkingIdSchema = z.string().min(1).describe("Golemio parking id, as returned by find_parking_near");

const runTool = async (toolName: string, handler: () => Promise<object>): Promise<CallToolResult> => {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await handler()) }] };
  } catch (error) {
    const reason = describeError(error);
    console.error(`${LOG_PREFIX} ${toolName} failed: ${reason}`);
    return { content: [{ type: "text", text: `${toolName} failed: ${reason}` }], isError: true };
  }
};

const findTariff = (place: ParkingPlace, tariffs: Map<string, Tariff>): Tariff | undefined =>
  place.tariffId ? tariffs.get(place.tariffId) : undefined;

const priceStay = (tariff: Tariff | undefined, arriveAt: Date, durationMinutes: number): StayCost | UnknownPrice => {
  if (!tariff) {
    return { confidence: "estimate", note: NO_TARIFF_NOTE };
  }
  return calculateStayCost(tariff, arriveAt, durationMinutes) ?? { confidence: "estimate", note: NO_VALID_BAND_NOTE };
};

/** Golemio averages occupancy per weekday and hour; a public holiday does not follow its weekday's pattern. */
const describeUsualAvailability = (status: SingleParkingStatus, at: Date): Availability => {
  if (status.usualOccupiedAtArrival === undefined) {
    return { totalSpots: status.totalSpots, confidence: "estimate", note: "Golemio has no average occupancy for this hour" };
  }
  const freeSpots = toUsualFreeSpots(status.totalSpots, status.usualOccupiedAtArrival);
  if (isCzechPublicHoliday(at)) {
    return {
      freeSpots,
      totalSpots: status.totalSpots,
      confidence: "estimate",
      note: "Usual free spaces for this weekday and hour, but the day is a public holiday",
    };
  }
  return { freeSpots, totalSpots: status.totalSpots, confidence: "historical", note: "Usual free spaces for this weekday and hour" };
};

const describeAvailabilityAtArrival = async (apiKey: string, place: ParkingPlace, arriveAt: Date, now: Date): Promise<Availability> => {
  if (!place.hasOccupancyInfo) {
    return { totalSpots: place.capacity, confidence: "estimate", note: "No occupancy data for this place" };
  }
  try {
    const status = await fetchSingleParkingStatus(apiKey, place.id, arriveAt);
    if (Math.abs(arriveAt.getTime() - now.getTime()) <= LIVE_ARRIVAL_WINDOW_MS) {
      return { freeSpots: status.freeNow, totalSpots: status.totalSpots, updatedAt: status.updatedAt, confidence: "live" };
    }
    return describeUsualAvailability(status, arriveAt);
  } catch (error) {
    const reason = describeError(error);
    console.error(`${LOG_PREFIX} occupancy of ${place.id} failed: ${reason}`);
    return { totalSpots: place.capacity, confidence: "estimate", note: "Occupancy data is unavailable right now" };
  }
};

const hasDedicatedSpaces = (place: ParkingPlace, requirement: Requirement): boolean =>
  requirement === "disabled" ? place.dedicatedSpaces.disabled > 0 : place.dedicatedSpaces.evCharging > 0;

/** Street segments of one zone share a tariff, so only the nearest of them is useful; P+R car parks differ in occupancy. */
const keepNearestPerTariff = (places: readonly NearbyParkingPlace[]): NearbyParkingPlace[] => {
  const seenKeys = new Set<string>();
  return places.filter((place) => {
    const key = place.kind === "park_and_ride" ? place.id : (place.tariffId ?? `${place.kind}:no-tariff`);
    if (seenKeys.has(key)) {
      return false;
    }
    seenKeys.add(key);
    return true;
  });
};

/** Round-robin over kinds in distance order, so the nearest P+R is not crowded out by closer garages. */
const pickAcrossKinds = (places: readonly NearbyParkingPlace[], limit: number): NearbyParkingPlace[] => {
  const queues = PARKING_KINDS.map((kind) => places.filter((place) => place.kind === kind));
  const picked: NearbyParkingPlace[] = [];
  for (let round = 0; picked.length < limit && queues.some((queue) => round < queue.length); round += 1) {
    queues.forEach((queue) => {
      const place = queue[round];
      if (place && picked.length < limit) {
        picked.push(place);
      }
    });
  }
  return picked.sort((first, second) => first.distanceMeters - second.distanceMeters);
};

const registerFindParkingNear = (server: McpServer, apiKey: string): void => {
  server.registerTool(
    "find_parking_near",
    {
      title: "Find parking near a destination",
      description:
        "Parking near a destination in Prague from Golemio open data: paid street zones, garages and paid car parks, and P+R car parks. " +
        "Returns the nearest place per tariff, mixed across kinds, with the straight-line distance, the price for the whole stay in CZK " +
        "and availability at arrival. price.fitsStay=false means the stay is longer than the place allows (the price then covers the maximum stay). " +
        "Each confidence is live (measured now, or priced by the current tariff), historical (usual for this weekday and hour) " +
        "or estimate (no data, or the data does not cover the stay).",
      inputSchema: {
        lat: z.number().min(-90).max(90).describe("Destination latitude (WGS 84)"),
        lon: z.number().min(-180).max(180).describe("Destination longitude (WGS 84)"),
        arriveAt: isoDateTimeSchema.describe("Arrival, ISO 8601 with offset, e.g. 2026-11-14T08:00:00+01:00"),
        durationMinutes: z.number().int().min(1).max(MAX_STAY_MINUTES).describe("Length of the stay, e.g. 540 for 08:00–17:00"),
        maxWalkMeters: z
          .number()
          .int()
          .min(50)
          .max(3000)
          .default(DEFAULT_MAX_WALK_METERS)
          .describe("Maximum straight-line distance from the destination"),
        types: z
          .array(z.enum(PARKING_KINDS))
          .optional()
          .describe("street = paid zones and on-street parking, garage = garages and paid car parks, park_and_ride = P+R; all when omitted"),
        requires: z.array(z.enum(REQUIREMENTS)).default([]).describe("Only places with dedicated disabled or EV charging spaces"),
        limit: z.number().int().min(1).max(20).default(DEFAULT_RESULT_LIMIT).describe("Maximum number of places"),
      },
      annotations: READ_ONLY_TOOL,
    },
    ({ lat, lon, arriveAt, durationMinutes, maxWalkMeters, types, requires, limit }) =>
      runTool("find_parking_near", async () => {
        const arrival = parseIsoDate(arriveAt);
        const now = new Date();
        const [places, tariffs] = await Promise.all([fetchParkingNear(apiKey, { lat, lon }, maxWalkMeters), fetchTariffsById(apiKey)]);
        const matching = places.filter(
          (place) => (!types || types.includes(place.kind)) && requires.every((requirement) => hasDedicatedSpaces(place, requirement)),
        );
        const spots = [];
        for (const place of pickAcrossKinds(keepNearestPerTariff(matching), limit)) {
          const { disabled, evCharging } = place.dedicatedSpaces;
          spots.push({
            id: place.id,
            name: place.name,
            kind: place.kind,
            zone: place.zone,
            distanceMeters: place.distanceMeters,
            capacity: place.capacity,
            dedicatedSpaces: disabled + evCharging > 0 ? place.dedicatedSpaces : undefined,
            price: priceStay(findTariff(place, tariffs), arrival, durationMinutes),
            availability: await describeAvailabilityAtArrival(apiKey, place, arrival, now),
          });
        }
        return {
          arriveAt: toPragueIso(arrival),
          durationMinutes,
          isPublicHoliday: isCzechPublicHoliday(arrival),
          placesWithinDistance: matching.length,
          spots,
        };
      }),
  );
};

const registerGetPrOccupancy = (server: McpServer, apiKey: string): void => {
  server.registerTool(
    "get_pr_occupancy",
    {
      title: "P+R occupancy",
      description:
        "Current and usual occupancy of one P+R car park (Golemio). current is live; usual is the average number of free spaces " +
        "for the weekday and hour of `at` (historical, or estimate on a public holiday).",
      inputSchema: {
        parkingId: parkingIdSchema,
        at: isoDateTimeSchema.optional().describe("Time for the usual occupancy, ISO 8601 with offset; now when omitted"),
      },
      annotations: READ_ONLY_TOOL,
    },
    ({ parkingId, at }) =>
      runTool("get_pr_occupancy", async () => {
        const moment = at ? parseIsoDate(at) : new Date();
        const status = await fetchSingleParkingStatus(apiKey, parkingId, moment);
        return {
          parkingId,
          totalSpots: status.totalSpots,
          current: { freeSpots: status.freeNow, updatedAt: status.updatedAt, confidence: "live" },
          usual: { at: toPragueIso(moment), ...describeUsualAvailability(status, moment) },
        };
      }),
  );
};

const registerGetParkingTariff = (server: McpServer, apiKey: string): void => {
  server.registerTool(
    "get_parking_tariff",
    {
      title: "Parking tariff",
      description:
        "Tariff of one parking place (Golemio): rates in plain words, maximum stay, public holiday rules, payment methods and link, " +
        "and the price in CZK for a stay when durationMinutes is given. Several options are alternative products (e.g. hourly or day pass). " +
        "confidence is live when the current tariff prices the whole stay, estimate when it leaves part of the stay uncovered or the stay is too long.",
      inputSchema: {
        parkingId: parkingIdSchema,
        arriveAt: isoDateTimeSchema.describe("Arrival, ISO 8601 with offset"),
        durationMinutes: z.number().int().min(1).max(MAX_STAY_MINUTES).optional().describe("Length of the stay to price"),
      },
      annotations: READ_ONLY_TOOL,
    },
    ({ parkingId, arriveAt, durationMinutes }) =>
      runTool("get_parking_tariff", async () => {
        const arrival = parseIsoDate(arriveAt);
        const [place, tariffs] = await Promise.all([fetchParkingById(apiKey, parkingId), fetchTariffsById(apiKey)]);
        const tariff = findTariff(place, tariffs);
        const summary = {
          parkingId,
          name: place.name,
          kind: place.kind,
          zone: place.zone,
          isPublicHoliday: isCzechPublicHoliday(arrival),
          paymentUrl: place.paymentUrl,
        };
        if (!tariff) {
          return { ...summary, confidence: "estimate", note: NO_TARIFF_NOTE };
        }
        const options = describeTariffOptions(tariff, arrival);
        const stay = durationMinutes ? priceStay(tariff, arrival, durationMinutes) : undefined;
        const tariffConfidence: Confidence = options.length > 0 ? "live" : "estimate";
        return { ...summary, options, stay, confidence: stay?.confidence ?? tariffConfidence };
      }),
  );
};

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const apiKey = requireEnv("GOLEMIO_API_KEY");
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  registerFindParkingNear(server, apiKey);
  registerGetPrOccupancy(server, apiKey);
  registerGetParkingTariff(server, apiKey);
  // stdout carries the MCP protocol, so every log goes to stderr.
  await server.connect(new StdioServerTransport());
  console.error(`${LOG_PREFIX} ready on stdio`);
};

await main();
