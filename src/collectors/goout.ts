import { setTimeout as sleep } from "node:timers/promises";
import type { Item } from "../item";
import { fetchText } from "../libs/http.utils";
import { extractSchemaEvents, type SchemaEvent } from "../libs/jsonld.utils";
import { parseJsDateString, pragueClock, pragueToday } from "../libs/time.utils";
import { mapRecordsSafely, schemaEventToItem } from "./collector.utils";
import type { Collector } from "./types";

const DELAY_BETWEEN_REQUESTS_MS = 500;
const CATEGORY_PATH_INDEX = 2;
const PLACEHOLDER_END_CLOCK = "23:59";

/**
 * GoOut gives single-day events without a known end an endDate of 23:59 that day, which reads like a real end time.
 * A 23:59 on a later day (exhibitions) is a real last day and is kept.
 */
const dropPlaceholderEnd = (event: SchemaEvent): SchemaEvent => {
  if (!event.endDate) {
    return event;
  }
  const start = parseJsDateString(event.startDate);
  const end = parseJsDateString(event.endDate);
  const isPlaceholder = pragueToday(end) === pragueToday(start) && pragueClock(end) === PLACEHOLDER_END_CLOCK;
  return isPlaceholder ? { ...event, endDate: undefined } : event;
};

/** Listing URLs look like /en/kladno/plays/lezgawlkkzg/, the third path segment is the category. */
const readCategory = (listingUrl: string): string =>
  new URL(listingUrl).pathname.split("/").filter(Boolean)[CATEGORY_PATH_INDEX] ?? "events";

export const collectGoOutEvents: Collector = async ({ profile, fetchedAt }) => {
  const itemsByUrl = new Map<string, Item>();
  for (const listingUrl of profile.events.gooutListingUrls) {
    const events = extractSchemaEvents(await fetchText(listingUrl));
    const category = readCategory(listingUrl);
    const items = mapRecordsSafely(
      events,
      (event) =>
        schemaEventToItem(dropPlaceholderEnd(event), {
          source: "goout",
          parseDate: parseJsDateString,
          tags: ["goout", category],
          fetchedAt,
        }),
      `goout:${category}`,
    );
    items.forEach((item) => {
      if (!itemsByUrl.has(item.url)) {
        itemsByUrl.set(item.url, item);
      }
    });
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }
  return [...itemsByUrl.values()];
};
