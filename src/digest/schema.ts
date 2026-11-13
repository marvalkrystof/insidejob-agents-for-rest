import { z } from "zod";
import { SOURCE_IDS } from "../item";
import { commutePlanSchema } from "../route/commute";

export const DIGEST_SECTIONS = ["commute", "home", "town", "events"] as const;
export type DigestSection = (typeof DIGEST_SECTIONS)[number];

export const digestEntrySchema = z.object({
  ref: z.number().int().positive(),
  section: z.enum(DIGEST_SECTIONS),
  itemId: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  day: z.string().optional(),
  when: z.string().optional(),
  reason: z.string(),
  details: z.string().optional(),
  url: z.string().url(),
  source: z.union([z.enum(SOURCE_IDS), z.literal("tomtom")]),
  confidence: z.enum(["official", "scraped", "inferred"]),
  isNew: z.boolean(),
});
export type DigestEntry = z.infer<typeof digestEntrySchema>;

export const noticeExtractionSchema = z.object({
  notices: z.array(
    z.object({
      index: z.number().int(),
      category: z.enum(["road_closure", "construction", "utilities", "bylaw", "other"]),
      street: z.string().nullable(),
      affectsResidents: z.boolean(),
      summary: z.string(),
    }),
  ),
});
export type NoticeExtraction = z.infer<typeof noticeExtractionSchema>;

export const composedDigestSchema = z.object({
  headline: z.string(),
  sections: z.array(
    z.object({
      section: z.enum(DIGEST_SECTIONS),
      title: z.string(),
      bullets: z.array(z.object({ text: z.string(), refs: z.array(z.number().int()) })),
    }),
  ),
});
export type ComposedDigest = z.infer<typeof composedDigestSchema>;

export const storedDigestSchema = z.object({
  generatedAt: z.string(),
  asOf: z.string(),
  model: z.string(),
  commute: commutePlanSchema,
  entries: z.array(digestEntrySchema),
  digest: composedDigestSchema,
});
export type StoredDigest = z.infer<typeof storedDigestSchema>;
