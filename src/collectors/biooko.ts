import { fetchText } from "../libs/http.utils";
import { extractSchemaEvents } from "../libs/jsonld.utils";
import { parseIsoDate } from "../libs/time.utils";
import { mapRecordsSafely, schemaEventToItem } from "./collector.utils";
import type { Collector } from "./types";

const PROGRAM_URL = "https://www.biooko.net/";

export const collectBioOkoScreenings: Collector = async ({ fetchedAt }) => {
  const events = extractSchemaEvents(await fetchText(PROGRAM_URL));
  return mapRecordsSafely(
    events,
    (event) =>
      schemaEventToItem(event, {
        source: "biooko",
        parseDate: parseIsoDate,
        tags: ["biooko", "cinema"],
        fetchedAt,
      }),
    "biooko",
  );
};
