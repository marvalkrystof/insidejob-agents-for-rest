import { z } from "zod";
import { buildItem } from "../item";
import { extractLonLatPairs } from "../libs/geo.utils";
import { fetchJson } from "../libs/http.utils";
import { collapseWhitespace, truncate } from "../libs/text.utils";
import { parsePragueEndOfDay, parsePragueWallClock, pragueToday, toPragueIso } from "../libs/time.utils";
import { mapRecordsSafely } from "./collector.utils";
import type { Collector } from "./types";

const DATA_URL = "https://stavby.ksus.cz/useky.json";
const PUBLIC_MAP_URL = "https://stavby.ksus.cz/";
const EVIDENCE_MAX_LENGTH = 300;

const featureSchema = z.object({
  properties: z.object({
    id: z.union([z.number(), z.string()]).transform(String),
    name: z.string(),
    dateStart: z.string(),
    dateEnd: z.string(),
    description: z.string().nullish(),
    okres: z.string().nullish(),
  }),
  geometry: z.unknown(),
});
const collectionSchema = z.object({ features: z.array(z.unknown()) });

export const collectCentralBohemiaClosures: Collector = async ({ fetchedAt }) => {
  const { features } = collectionSchema.parse(await fetchJson(DATA_URL));
  const today = pragueToday();
  return mapRecordsSafely(
    features,
    (record) => {
      const { properties, geometry } = featureSchema.parse(record);
      // Many sections have no dates at all; without them we cannot tell whether the closure is active.
      if (!properties.dateStart || !properties.dateEnd || properties.dateEnd < today) {
        return undefined;
      }
      return buildItem({
        source: "ksus",
        sourceKey: properties.id,
        type: "closure",
        title: collapseWhitespace(properties.name),
        geo: { line: extractLonLatPairs(geometry), municipality: properties.okres ?? undefined },
        timeRange: {
          from: toPragueIso(parsePragueWallClock(properties.dateStart)),
          to: toPragueIso(parsePragueEndOfDay(properties.dateEnd)),
        },
        url: PUBLIC_MAP_URL,
        fetchedAt,
        confidence: "official",
        severity: "medium",
        evidence: properties.description ? truncate(collapseWhitespace(properties.description), EVIDENCE_MAX_LENGTH) : undefined,
      });
    },
    "ksus",
  );
};
