import { createHash } from "node:crypto";
import { z } from "zod";

export const SOURCE_IDS = ["cez", "opravujeme", "ksus", "pid", "goout", "biooko", "uredni-deska", "golemio", "facebook"] as const;
export const ITEM_TYPES = ["outage", "closure", "transit", "event", "notice", "community", "parking"] as const;

const isoDateTimeSchema = z.string().datetime({ offset: true });
const lonLatSchema = z.tuple([z.number(), z.number()]);

export const itemSchema = z.object({
  id: z.string(),
  source: z.enum(SOURCE_IDS),
  sourceKey: z.string(),
  type: z.enum(ITEM_TYPES),
  title: z.string().min(1),
  summary: z.string().optional(),
  geo: z
    .object({
      lat: z.number().optional(),
      lon: z.number().optional(),
      line: z.array(lonLatSchema).optional(),
      municipality: z.string().optional(),
      street: z.string().optional(),
    })
    .optional(),
  timeRange: z.object({ from: isoDateTimeSchema, to: isoDateTimeSchema.optional() }).optional(),
  url: z.string().url(),
  fetchedAt: isoDateTimeSchema,
  confidence: z.enum(["official", "scraped", "inferred"]),
  severity: z.enum(["low", "medium", "high"]).optional(),
  actionHint: z.string().optional(),
  evidence: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export type Item = z.infer<typeof itemSchema>;
export type SourceId = Item["source"];
export type LonLat = z.infer<typeof lonLatSchema>;

export const createItemId = (source: SourceId, sourceKey: string): string =>
  createHash("sha1").update(`${source}:${sourceKey}`).digest("hex");

export const buildItem = (fields: Omit<Item, "id">): Item => ({
  id: createItemId(fields.source, fields.sourceKey),
  ...fields,
});
