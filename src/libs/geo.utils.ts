import type { LonLat } from "../item";

const EARTH_RADIUS_METERS = 6_371_000;
const DEGREES_TO_RADIANS = Math.PI / 180;

export const haversineMeters = ([lonA, latA]: LonLat, [lonB, latB]: LonLat): number => {
  const deltaLat = (latB - latA) * DEGREES_TO_RADIANS;
  const deltaLon = (lonB - lonA) * DEGREES_TO_RADIANS;
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(latA * DEGREES_TO_RADIANS) * Math.cos(latB * DEGREES_TO_RADIANS) * Math.sin(deltaLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
};

/** Equirectangular projection around the point: accurate enough for distances of a few kilometres. */
const projectToMeters = ([lon, lat]: LonLat, originLat: number): [number, number] => [
  lon * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS * Math.cos(originLat * DEGREES_TO_RADIANS),
  lat * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS,
];

const distanceToSegmentMeters = (point: LonLat, segmentStart: LonLat, segmentEnd: LonLat): number => {
  const originLat = point[1];
  const [px, py] = projectToMeters(point, originLat);
  const [ax, ay] = projectToMeters(segmentStart, originLat);
  const [bx, by] = projectToMeters(segmentEnd, originLat);
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

export const distanceToPolylineMeters = (point: LonLat, polyline: LonLat[]): number => {
  const [first] = polyline;
  if (!first) {
    return Number.POSITIVE_INFINITY;
  }
  if (polyline.length === 1) {
    return haversineMeters(point, first);
  }
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < polyline.length; index += 1) {
    const segmentStart = polyline[index - 1];
    const segmentEnd = polyline[index];
    if (!segmentStart || !segmentEnd) {
      continue;
    }
    minimum = Math.min(minimum, distanceToSegmentMeters(point, segmentStart, segmentEnd));
  }
  return minimum;
};

export const polylinesDistanceMeters = (line: LonLat[], route: LonLat[]): number => {
  const lineToRoute = line.map((point) => distanceToPolylineMeters(point, route));
  const routeToLine = route.map((point) => distanceToPolylineMeters(point, line));
  return Math.min(...lineToRoute, ...routeToLine);
};

const collectLonLatPairs = (value: unknown, pairs: LonLat[]): void => {
  if (!Array.isArray(value)) {
    return;
  }
  const [first, second] = value;
  if (typeof first === "number" && typeof second === "number") {
    pairs.push([first, second]);
    return;
  }
  value.forEach((entry) => collectLonLatPairs(entry, pairs));
};

/** Flattens every GeoJSON `coordinates` array (any geometry type) into [lon, lat] pairs. */
export const extractLonLatPairs = (geoJson: unknown): LonLat[] => {
  const pairs: LonLat[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    Object.entries(value).forEach(([key, entry]) => {
      if (key === "coordinates") {
        collectLonLatPairs(entry, pairs);
        return;
      }
      visit(entry);
    });
  };
  visit(geoJson);
  return pairs;
};

export const downsamplePolyline =(polyline: LonLat[], maxPoints: number): LonLat[] => {
  if (polyline.length <= maxPoints) {
    return polyline;
  }
  const step = Math.ceil(polyline.length / maxPoints);
  const sampled = polyline.filter((_, index) => index % step === 0);
  const last = polyline[polyline.length - 1];
  if (last && sampled[sampled.length - 1] !== last) {
    sampled.push(last);
  }
  return sampled;
};
