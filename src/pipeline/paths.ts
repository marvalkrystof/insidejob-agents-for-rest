import { join } from "node:path";
import type { SourceId } from "../item";

export const DATA_DIR = "data";
export const FIXTURES_DIR = "fixtures";
export const ITEMS_PATH = join(DATA_DIR, "items.json");
export const COMMUTE_FIXTURE_PATH = join(FIXTURES_DIR, "commute.json");
export const DIGEST_PATH = join(DATA_DIR, "digest.json");

export const fixturePath = (source: SourceId): string => join(FIXTURES_DIR, `${source}.json`);
