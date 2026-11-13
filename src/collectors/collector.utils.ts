import { buildItem, type Item } from "../item";
import { describeError } from "../libs/error.utils";
import { firstOffer, formatPrice, type SchemaEvent } from "../libs/jsonld.utils";
import { toPragueIso } from "../libs/time.utils";

/** One malformed record must not drop the whole source; skipped records are reported instead. */
export const mapRecordsSafely = <TRecord>(
  records: readonly TRecord[],
  mapRecord: (record: TRecord) => Item | undefined,
  sourceLabel: string,
): Item[] => {
  let skippedCount = 0;
  let firstErrorMessage = "";
  const items = records.flatMap((record) => {
    try {
      const item = mapRecord(record);
      return item ? [item] : [];
    } catch (error) {
      skippedCount += 1;
      firstErrorMessage ||= describeError(error);
      return [];
    }
  });
  if (skippedCount > 0) {
    console.warn(`[${sourceLabel}] skipped ${skippedCount} malformed record(s), first: ${firstErrorMessage.slice(0, 200)}`);
  }
  return items;
};

interface SchemaEventMapping {
  source: "goout" | "biooko";
  parseDate: (raw: string) => Date;
  tags: string[];
  fetchedAt: string;
}

export const schemaEventToItem = (event: SchemaEvent, mapping: SchemaEventMapping): Item => {
  const offer = firstOffer(event);
  const address = event.location?.address;
  const evidence = [event.location?.name, formatPrice(offer)]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return buildItem({
    source: mapping.source,
    sourceKey: event.url,
    type: "event",
    title: event.name,
    geo: {
      municipality: address?.addressRegion ?? address?.addressLocality,
      street: address?.streetAddress,
    },
    timeRange: {
      from: toPragueIso(mapping.parseDate(event.startDate)),
      to: event.endDate ? toPragueIso(mapping.parseDate(event.endDate)) : undefined,
    },
    url: event.url,
    fetchedAt: mapping.fetchedAt,
    confidence: "scraped",
    tags: mapping.tags,
    evidence: evidence || undefined,
    actionHint: offer?.url && offer.url !== event.url ? `Tickets: ${offer.url}` : undefined,
  });
};
