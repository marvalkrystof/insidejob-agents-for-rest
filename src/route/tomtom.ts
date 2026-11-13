import { z } from "zod";
import type { LonLat } from "../item";
import { downsamplePolyline } from "../libs/geo.utils";
import { fetchJson } from "../libs/http.utils";
import { parseIsoDate, toPragueIso } from "../libs/time.utils";
import type { Coordinates } from "../profile";

const ROUTING_BASE_URL = "https://api.tomtom.com/routing/1/calculateRoute";
const MAX_ROUTE_POINTS = 400;

const routeResponseSchema = z.object({
  routes: z
    .array(
      z.object({
        summary: z.object({
          lengthInMeters: z.number(),
          travelTimeInSeconds: z.number(),
          trafficDelayInSeconds: z.number(),
          departureTime: z.string(),
          arrivalTime: z.string(),
          noTrafficTravelTimeInSeconds: z.number().optional(),
        }),
        legs: z.array(z.object({ points: z.array(z.object({ latitude: z.number(), longitude: z.number() })) })),
      }),
    )
    .min(1),
});

export const plannedRouteSchema = z.object({
  polyline: z.array(z.tuple([z.number(), z.number()])),
  lengthMeters: z.number(),
  travelTimeSeconds: z.number(),
  trafficDelaySeconds: z.number(),
  noTrafficTravelTimeSeconds: z.number().optional(),
  departureTime: z.string(),
  arrivalTime: z.string(),
});

export type PlannedRoute = z.infer<typeof plannedRouteSchema>;

/** Car route that arrives at `arriveAt`; for future times TomTom uses historic traffic patterns. */
export const planRouteArrivingAt = async (
  apiKey: string,
  from: Coordinates,
  to: Coordinates,
  arriveAt: Date,
): Promise<PlannedRoute> => {
  const params = new URLSearchParams({
    key: apiKey,
    traffic: "true",
    travelMode: "car",
    routeType: "fastest",
    computeTravelTimeFor: "all",
    arriveAt: toPragueIso(arriveAt),
  });
  const url = `${ROUTING_BASE_URL}/${from.lat},${from.lon}:${to.lat},${to.lon}/json?${params.toString()}`;
  const [route] = routeResponseSchema.parse(await fetchJson(url)).routes;
  if (!route) {
    throw new Error("TomTom returned no route");
  }
  const polyline: LonLat[] = route.legs.flatMap((leg) => leg.points.map((point): LonLat => [point.longitude, point.latitude]));
  return {
    polyline: downsamplePolyline(polyline, MAX_ROUTE_POINTS),
    lengthMeters: route.summary.lengthInMeters,
    travelTimeSeconds: route.summary.travelTimeInSeconds,
    trafficDelaySeconds: route.summary.trafficDelayInSeconds,
    noTrafficTravelTimeSeconds: route.summary.noTrafficTravelTimeInSeconds,
    departureTime: toPragueIso(parseIsoDate(route.summary.departureTime)),
    arrivalTime: toPragueIso(parseIsoDate(route.summary.arrivalTime)),
  };
};
