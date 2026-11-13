import * as cheerio from "cheerio";
import { z } from "zod";

const offerSchema = z.object({
  url: z.string().url().optional(),
  price: z.union([z.string(), z.number()]).optional(),
  priceCurrency: z.string().optional(),
});

const schemaEventSchema = z.object({
  "@type": z.string(),
  name: z.string(),
  url: z.string().url(),
  startDate: z.string(),
  endDate: z.string().optional(),
  location: z
    .object({
      name: z.string().optional(),
      address: z
        .object({
          streetAddress: z.string().optional(),
          addressLocality: z.string().optional(),
          addressRegion: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
  offers: z.union([offerSchema, z.array(offerSchema)]).optional(),
});

export type SchemaEvent = z.infer<typeof schemaEventSchema>;
export type SchemaOffer = z.infer<typeof offerSchema>;

const parseJsonLdBlocks = (html: string): unknown[] => {
  const $ = cheerio.load(html);
  const blocks: unknown[] = [];
  $('script[type="application/ld+json"]').each((_, element) => {
    const raw = $(element).html();
    if (!raw) {
      return;
    }
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Pages occasionally embed malformed blocks next to valid ones; one bad block must not drop the page.
    }
  });
  return blocks;
};

const collectEventCandidates = (value: unknown, candidates: unknown[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEventCandidates(entry, candidates));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  const type = (value as Record<string, unknown>)["@type"];
  if (typeof type === "string" && type.endsWith("Event")) {
    candidates.push(value);
  }
  Object.values(value).forEach((entry) => collectEventCandidates(entry, candidates));
};

export const extractSchemaEvents = (html: string): SchemaEvent[] => {
  const candidates: unknown[] = [];
  collectEventCandidates(parseJsonLdBlocks(html), candidates);
  return candidates.flatMap((candidate) => {
    const parsed = schemaEventSchema.safeParse(candidate);
    return parsed.success ? [parsed.data] : [];
  });
};

export const firstOffer = (event: SchemaEvent): SchemaOffer | undefined =>
  Array.isArray(event.offers) ? event.offers[0] : event.offers;

export const formatPrice = (offer: SchemaOffer | undefined): string | undefined => {
  if (offer?.price === undefined) {
    return undefined;
  }
  return `${offer.price} ${(offer.priceCurrency ?? "CZK").toUpperCase()}`;
};
