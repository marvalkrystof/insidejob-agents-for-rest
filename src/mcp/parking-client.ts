import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { toPragueIso } from "../libs/time.utils";
import type { ParkAndRide } from "../profile";
import type { ParkingStatus } from "../route/parking";

const PARKING_SERVER_ENTRY = "src/mcp/parking-server.ts";
const CLIENT_NAME = "domovnik-digest";
const CLIENT_VERSION = "0.1.0";
// Golemio splits one profile P+R into several car parks (Zličín 2 is 189 m from the profile point); the name prefix
// check below keeps a neighbouring P+R out.
const PARK_AND_RIDE_SEARCH_METERS = 500;
const MAX_CAR_PARKS_PER_PARK_AND_RIDE = 20;
// find_parking_near always prices a stay; the digest reads only the occupancy, so a working day is just a valid input.
const PRICED_STAY_MINUTES = 540;

const toolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});
const nearbyCarParksSchema = z.object({ spots: z.array(z.object({ id: z.string(), name: z.string() })) });
const carParkOccupancySchema = z.object({
  totalSpots: z.number(),
  current: z.object({ freeSpots: z.number(), updatedAt: z.string() }),
  usual: z.object({ freeSpots: z.number().optional() }),
});

type CarParkOccupancy = z.infer<typeof carParkOccupancySchema>;

/** How the agent and the digest start the Parking MCP server as a stdio child process. */
export const parkingServerProcess = () => ({
  command: process.execPath,
  args: ["--import", "tsx", PARKING_SERVER_ENTRY],
  cwd: process.cwd(),
});

const callParkingTool = async <TOutput>(
  client: Client,
  name: string,
  args: Record<string, unknown>,
  schema: z.ZodType<TOutput>,
): Promise<TOutput> => {
  const { content, isError } = toolResultSchema.parse(await client.callTool({ name, arguments: args }));
  const text = content.find((block) => block.type === "text")?.text ?? "";
  if (isError) {
    throw new Error(text || `${name} failed`);
  }
  return schema.parse(JSON.parse(text));
};

const findCarParkIds = async (client: Client, parkAndRide: ParkAndRide, arriveAt: string): Promise<string[]> => {
  const { spots } = await callParkingTool(
    client,
    "find_parking_near",
    {
      lat: parkAndRide.lat,
      lon: parkAndRide.lon,
      arriveAt,
      durationMinutes: PRICED_STAY_MINUTES,
      maxWalkMeters: PARK_AND_RIDE_SEARCH_METERS,
      types: ["park_and_ride"],
      limit: MAX_CAR_PARKS_PER_PARK_AND_RIDE,
    },
    nearbyCarParksSchema,
  );
  return spots.filter((spot) => spot.name.startsWith(parkAndRide.name)).map((spot) => spot.id);
};

const sumOccupancies = (parts: readonly CarParkOccupancy[]): ParkingStatus => {
  const hasUsualOccupancy = parts.every((part) => part.usual.freeSpots !== undefined);
  return {
    totalSpots: parts.reduce((sum, part) => sum + part.totalSpots, 0),
    freeNow: parts.reduce((sum, part) => sum + part.current.freeSpots, 0),
    updatedAt: parts.map((part) => part.current.updatedAt).sort()[0] ?? "",
    usualFreeAtArrival: hasUsualOccupancy ? parts.reduce((sum, part) => sum + (part.usual.freeSpots ?? 0), 0) : undefined,
  };
};

/** Current and usual P+R occupancy per profile P+R, read through the Parking MCP tools. */
export const fetchParkAndRideStatusesViaMcp = async (
  parkAndRides: readonly ParkAndRide[],
  arriveAt: Date,
): Promise<Map<string, ParkingStatus>> => {
  const client = new Client({ name: CLIENT_NAME, version: CLIENT_VERSION });
  await client.connect(new StdioClientTransport(parkingServerProcess()));
  try {
    const at = toPragueIso(arriveAt);
    const statuses = new Map<string, ParkingStatus>();
    for (const parkAndRide of parkAndRides) {
      const parts: CarParkOccupancy[] = [];
      for (const parkingId of await findCarParkIds(client, parkAndRide, at)) {
        parts.push(await callParkingTool(client, "get_pr_occupancy", { parkingId, at }, carParkOccupancySchema));
      }
      if (parts.length > 0) {
        statuses.set(parkAndRide.name, sumOccupancies(parts));
      }
    }
    return statuses;
  } finally {
    await client.close();
  }
};
