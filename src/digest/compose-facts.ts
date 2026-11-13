import type { DigestEntry } from "./schema";

// Free-text Czech details of closures, transit changes and notices led the model to embellish when translating;
// for those sources it gets only title, day, when and reason, and readers follow the [n] link for specifics.
const SOURCES_WITH_STRUCTURED_DETAILS = new Set<DigestEntry["source"]>(["tomtom", "cez", "goout", "biooko"]);

export interface ComposeFacts extends Omit<DigestEntry, "itemId" | "url" | "details" | "day" | "when"> {
  details?: string;
  day?: string;
  when?: string;
}

/**
 * The facts the composer sees for one entry; the fact check accepts only these.
 * A notice-board time range is the posting period, which the model restated as the duration of the works,
 * so notices come without day and when (the web page still shows the labelled posting period).
 */
export const toComposeFacts = ({ itemId: _itemId, url: _url, details, day, when, ...facts }: DigestEntry): ComposeFacts => ({
  ...facts,
  ...(SOURCES_WITH_STRUCTURED_DETAILS.has(facts.source) ? { details } : {}),
  ...(facts.source === "uredni-deska" ? {} : { day, when }),
});
