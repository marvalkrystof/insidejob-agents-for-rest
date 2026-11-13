import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { toPrettyJson } from "./items-store";
import { DATA_DIR } from "./paths";

const SEEN_PATH = join(DATA_DIR, "seen.json");
const seenSchema = z.record(z.string(), z.string());

/** Item ids already delivered in a digest, with the time they were first delivered. */
const readSeen = async (): Promise<Record<string, string>> => {
  if (!existsSync(SEEN_PATH)) {
    return {};
  }
  return seenSchema.parse(JSON.parse(await readFile(SEEN_PATH, "utf8")));
};

export const readSeenIds = async (): Promise<Set<string>> => new Set(Object.keys(await readSeen()));

export const rememberDelivered = async (itemIds: readonly string[], deliveredAt: string): Promise<void> => {
  const seen = await readSeen();
  itemIds.forEach((itemId) => {
    seen[itemId] ??= deliveredAt;
  });
  await writeFile(SEEN_PATH, toPrettyJson(seen));
};
