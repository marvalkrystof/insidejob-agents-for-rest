import { XMLParser } from "fast-xml-parser";
import { z } from "zod";
import { buildItem } from "../item";
import { fetchText } from "../libs/http.utils";
import { htmlToText, truncate } from "../libs/text.utils";
import { fromUnixSeconds, toPragueIso } from "../libs/time.utils";
import { mapRecordsSafely } from "./collector.utils";
import type { Collector } from "./types";

const FEED_URL = "https://pid.cz/feed/rss-vyluky/";
const EVIDENCE_MAX_LENGTH = 300;

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === "item" || name === "line",
});

const feedSchema = z.object({ rss: z.object({ channel: z.object({ item: z.array(z.unknown()).default([]) }) }) });
const entrySchema = z.object({
  title: z.string(),
  link: z.string().url(),
  guid: z.string(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  lines: z.union([z.object({ line: z.array(z.string()).default([]) }), z.literal("")]).optional(),
  "content:encoded": z.string().optional(),
});

const unixSecondsToPragueIso = (seconds: string | undefined): string | undefined => {
  if (!seconds) {
    return undefined;
  }
  return toPragueIso(fromUnixSeconds(Number(seconds)));
};

export const collectTransitDisruptions: Collector = async ({ fetchedAt }) => {
  const feed = feedSchema.parse(parser.parse(await fetchText(FEED_URL)));
  return mapRecordsSafely(
    feed.rss.channel.item,
    (record) => {
      const entry = entrySchema.parse(record);
      const from = unixSecondsToPragueIso(entry.dateFrom);
      const lines = typeof entry.lines === "object" ? entry.lines.line : [];
      const content = entry["content:encoded"];
      return buildItem({
        source: "pid",
        sourceKey: entry.guid,
        type: "transit",
        title: entry.title,
        timeRange: from ? { from, to: unixSecondsToPragueIso(entry.dateTo) } : undefined,
        url: entry.link,
        fetchedAt,
        confidence: "official",
        tags: lines,
        evidence: content ? truncate(htmlToText(content), EVIDENCE_MAX_LENGTH) : undefined,
      });
    },
    "pid",
  );
};
