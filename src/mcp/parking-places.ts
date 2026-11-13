import { z } from "zod";
import type { LonLat } from "../item";
import { haversineMeters } from "../libs/geo.utils";
import type { Coordinates } from "../profile";
import { fetchGolemio, GOLEMIO_CACHE_TTL_MS } from "../route/parking";

const METERS_PER_DEGREE_OF_LATITUDE = 111_320;
const DEGREES_TO_RADIANS = Math.PI / 180;
// Rounded so that repeated searches around the same point reuse the cached response.
const BOUNDING_BOX_DECIMALS = 4;
const GARAGE_PARKING_TYPES = new Set(["underground", "multi_storey"]);
// Customers only, or drop-off bays: not somewhere to park for the day.
const EXCLUDED_PARKING_POLICIES = new Set(["customer_only", "kiss_and_ride"]);

export const PARKING_KINDS = ["street", "garage", "park_and_ride"] as const;
export type ParkingKind = (typeof PARKING_KINDS)[number];

const parkingFeatureSchema = z.object({
  properties: z.object({
    id: z.string(),
    name: z.string().nullish(),
    primary_source: z.string(),
    centroid: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
    capacity: z.number().nullish(),
    parking_policy: z.string().nullish(),
    parking_type: z.string().nullish(),
    filter: z.string().nullish(),
    tariff: z.string().nullish(),
    has_occupancy_info: z.boolean().nullish(),
    address: z.object({ address_formatted: z.string().nullish() }).nullish(),
    payment: z.object({ web_url: z.string().nullish() }).nullish(),
    space: z
      .object({
        features: z.array(
          z.object({ properties: z.object({ capacity: z.number().nullish(), access_dedicated_to: z.array(z.string()).nullish() }) }),
        ),
      })
      .nullish(),
  }),
});
const parkingCollectionSchema = z.object({ features: z.array(parkingFeatureSchema) });

type ParkingProperties = z.infer<typeof parkingFeatureSchema>["properties"];

export interface DedicatedSpaces {
  disabled: number;
  evCharging: number;
}

export interface ParkingPlace {
  id: string;
  name: string;
  kind: ParkingKind;
  source: string;
  /** Paid-zone colour of a street segment (blue, orange, violet). */
  zone?: string;
  lonLat: LonLat;
  capacity?: number;
  tariffId?: string;
  hasOccupancyInfo: boolean;
  dedicatedSpaces: DedicatedSpaces;
  paymentUrl?: string;
}

export interface NearbyParkingPlace extends ParkingPlace {
  /** Straight line from the destination to the centre of the place. */
  distanceMeters: number;
}

const classifyParking = ({ parking_policy: policy, parking_type: type }: ParkingProperties): ParkingKind | undefined => {
  if (policy === "park_and_ride") {
    return "park_and_ride";
  }
  if (policy && EXCLUDED_PARKING_POLICIES.has(policy)) {
    return undefined;
  }
  if (type === "on_street" && policy !== "commercial") {
    return "street";
  }
  if (policy === "commercial" || (type && GARAGE_PARKING_TYPES.has(type))) {
    return "garage";
  }
  return undefined;
};

const countDedicatedSpaces = (space: ParkingProperties["space"]): DedicatedSpaces =>
  (space?.features ?? []).reduce(
    (counts, { properties: { capacity, access_dedicated_to: access } }) => ({
      disabled: counts.disabled + (access?.includes("disabled") ? (capacity ?? 0) : 0),
      evCharging: counts.evCharging + (access?.includes("charging") ? (capacity ?? 0) : 0),
    }),
    { disabled: 0, evCharging: 0 },
  );

const toParkingPlace = (properties: ParkingProperties): ParkingPlace | undefined => {
  const kind = classifyParking(properties);
  if (!kind) {
    return undefined;
  }
  return {
    id: properties.id,
    name: properties.name ?? properties.address?.address_formatted ?? properties.id,
    kind,
    source: properties.primary_source,
    zone: properties.parking_policy === "zone" ? (properties.filter ?? undefined) : undefined,
    lonLat: properties.centroid.coordinates,
    capacity: properties.capacity ?? undefined,
    tariffId: properties.tariff ?? undefined,
    hasOccupancyInfo: properties.has_occupancy_info ?? false,
    dedicatedSpaces: countDedicatedSpaces(properties.space),
    paymentUrl: properties.payment?.web_url ?? undefined,
  };
};

/** Public parking within `radiusMeters` (straight line) of the point, nearest first; one cached Golemio call. */
export const fetchParkingNear = async (apiKey: string, { lat, lon }: Coordinates, radiusMeters: number): Promise<NearbyParkingPlace[]> => {
  const latitudeDelta = radiusMeters / METERS_PER_DEGREE_OF_LATITUDE;
  const longitudeDelta = radiusMeters / (METERS_PER_DEGREE_OF_LATITUDE * Math.cos(lat * DEGREES_TO_RADIANS));
  // Golemio's order: top-left latitude and longitude, then bottom-right latitude and longitude.
  const boundingBox = [lat + latitudeDelta, lon - longitudeDelta, lat - latitudeDelta, lon + longitudeDelta]
    .map((value) => value.toFixed(BOUNDING_BOX_DECIMALS))
    .join(",");
  const { features } = parkingCollectionSchema.parse(
    await fetchGolemio(apiKey, `/v3/parking?boundingBox=${boundingBox}&limit=10000`, GOLEMIO_CACHE_TTL_MS.parkings),
  );
  return features
    .flatMap(({ properties }) => {
      const place = toParkingPlace(properties);
      if (!place) {
        return [];
      }
      const distanceMeters = Math.round(haversineMeters([lon, lat], place.lonLat));
      return distanceMeters <= radiusMeters ? [{ ...place, distanceMeters }] : [];
    })
    .sort((first, second) => first.distanceMeters - second.distanceMeters);
};

export const fetchParkingById = async (apiKey: string, parkingId: string): Promise<ParkingPlace> => {
  const { properties } = parkingFeatureSchema.parse(
    await fetchGolemio(apiKey, `/v3/parking/${encodeURIComponent(parkingId)}`, GOLEMIO_CACHE_TTL_MS.parkings),
  );
  const place = toParkingPlace(properties);
  if (!place) {
    throw new Error(`${parkingId} is not public street, garage or P+R parking`);
  }
  return place;
};
