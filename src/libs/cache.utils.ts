import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const cacheEntrySchema = z.object({ storedAt: z.number(), value: z.unknown() });

const pendingReads = new Map<string, Promise<unknown>>();

const readFreshValue = async (path: string, ttlMs: number): Promise<{ value: unknown } | undefined> => {
  try {
    const entry = cacheEntrySchema.parse(JSON.parse(await readFile(path, "utf8")));
    if (Date.now() - entry.storedAt >= ttlMs) {
      return undefined;
    }
    return { value: entry.value };
  } catch {
    // A missing or unreadable entry is simply loaded again.
    return undefined;
  }
};

const readOrLoad = async (directory: string, path: string, ttlMs: number, load: () => Promise<unknown>): Promise<unknown> => {
  const fresh = await readFreshValue(path, ttlMs);
  if (fresh) {
    return fresh.value;
  }
  const value = await load();
  await mkdir(directory, { recursive: true });
  await writeFile(path, JSON.stringify({ storedAt: Date.now(), value }));
  return value;
};

/**
 * Returns the value stored for `key` while it is younger than `ttlMs`, otherwise loads and stores it.
 * Concurrent calls for the same key share one read, so an identical request is never sent twice at once.
 */
export const readThroughFileCache = (
  directory: string,
  key: string,
  ttlMs: number,
  load: () => Promise<unknown>,
): Promise<unknown> => {
  const path = join(directory, `${createHash("sha1").update(key).digest("hex")}.json`);
  const pending = pendingReads.get(path);
  if (pending) {
    return pending;
  }
  const reading = readOrLoad(directory, path, ttlMs, load).finally(() => pendingReads.delete(path));
  pendingReads.set(path, reading);
  return reading;
};
