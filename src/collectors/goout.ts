import { setTimeout as sleep } from "node:timers/promises";
import type { Item } from "../item";
import { fetchText } from "../libs/http.utils";
import { extractSchemaEvents } from "../libs/jsonld.utils";
import { parseJsDateString } from "../libs/time.utils";
import { mapRecordsSafely, schemaEventToItem } from "./collector.utils";
import type { Collector } from "./types";

const DELAY_BETWEEN_REQUESTS_MS = 500;
const CATEGORY_PATH_INDEX = 2;

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
        schemaEventToItem(event, {
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
