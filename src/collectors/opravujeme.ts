import { z } from "zod";
import { buildItem } from "../item";
import { downsamplePolyline, extractLonLatPairs } from "../libs/geo.utils";
import { fetchJson } from "../libs/http.utils";
import { htmlToText, truncate } from "../libs/text.utils";
import { parsePragueWallClock, toPragueIso } from "../libs/time.utils";
import { mapRecordsSafely } from "./collector.utils";
import type { Collector } from "./types";

const API_URL = "https://opravujeme.to/api/action";
const DETAIL_BASE_URL = "https://opravujeme.to/action";
const RELEVANT_STATES = new Set(["ACTIVE", "FUTURE"]);
const SEVERITY_BY_COLOR = { GREEN: "low", YELLOW: "medium", RED: "high" } as const;
const MAX_LINE_POINTS = 200;
const EVIDENCE_MAX_LENGTH = 300;

// Only fields we use are parsed; contractor/investor/responsible contacts never leave this module.
const actionSchema = z.object({
  id: z.number(),
  name: z.string(),
  street: z.string().nullish(),
  start: z.string(),
  end: z.string().nullish(),
  state: z.string(),
  severity: z.enum(["GREEN", "YELLOW", "RED"]).nullish(),
  hidden: z.boolean().nullish(),
  lat: z.number().nullish(),
  lon: z.number().nullish(),
  geo_json: z.string().nullish(),
  limitations: z.string().nullish(),
});
const responseSchema = z.object({ data: z.array(z.unknown()) });

const parseLine = (geoJson: string | null | undefined): [number, number][] | undefined => {
  if (!geoJson) {
    return undefined;
  }
  const pairs = extractLonLatPairs(JSON.parse(geoJson));
  return pairs.length > 0 ? downsamplePolyline(pairs, MAX_LINE_POINTS) : undefined;
};

export const collectPragueClosures: Collector = async ({ fetchedAt }) => {
  const { data } = responseSchema.parse(await fetchJson(API_URL));
  return mapRecordsSafely(
    data,
    (record) => {
      const action = actionSchema.parse(record);
      if (!RELEVANT_STATES.has(action.state) || action.hidden) {
        return undefined;
      }
      return buildItem({
        source: "opravujeme",
        sourceKey: String(action.id),
        type: "closure",
        title: action.name,
        geo: {
          lat: action.lat ?? undefined,
          lon: action.lon ?? undefined,
          line: parseLine(action.geo_json),
          municipality: "Praha",
          street: action.street ?? undefined,
        },
        timeRange: {
          from: toPragueIso(parsePragueWallClock(action.start)),
          to: action.end ? toPragueIso(parsePragueWallClock(action.end)) : undefined,
        },
        url: `${DETAIL_BASE_URL}/${action.id}`,
        fetchedAt,
        confidence: "official",
        severity: action.severity ? SEVERITY_BY_COLOR[action.severity] : undefined,
        evidence: action.limitations ? truncate(htmlToText(action.limitations), EVIDENCE_MAX_LENGTH) : undefined,
      });
    },
    "opravujeme",
  );
};
