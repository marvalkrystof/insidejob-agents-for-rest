import { mkdir, readFile, writeFile } from "node:fs/promises";
import { collectBioOkoScreenings } from "../collectors/biooko";
import { collectCezOutages } from "../collectors/cez";
import { collectGoOutEvents } from "../collectors/goout";
import { collectCentralBohemiaClosures } from "../collectors/ksus";
import { collectPragueClosures } from "../collectors/opravujeme";
import { collectTransitDisruptions } from "../collectors/pid";
import type { Collector, CollectorContext } from "../collectors/types";
import { collectMunicipalBoard } from "../collectors/uredni-deska";
import { itemSchema, type Item, type SourceId } from "../item";
import { loadEnvFileIfPresent } from "../libs/env.utils";
import { toPragueIso } from "../libs/time.utils";
import { loadProfile } from "../profile";
import { toPrettyJson, writeCollectedItems } from "./items-store";
import { DATA_DIR, FIXTURES_DIR, ITEMS_PATH, fixturePath } from "./paths";

const COLLECTORS: ReadonlyArray<readonly [SourceId, Collector]> = [
  ["cez", collectCezOutages],
  ["opravujeme", collectPragueClosures],
  ["ksus", collectCentralBohemiaClosures],
  ["pid", collectTransitDisruptions],
  ["goout", collectGoOutEvents],
  ["biooko", collectBioOkoScreenings],
  ["uredni-deska", collectMunicipalBoard],
];

interface SourceReport {
  source: SourceId;
  items: Item[];
  invalidCount: number;
  firstIssue?: string;
  error?: string;
}

const readFixture = async (source: SourceId): Promise<unknown[]> => {
  const parsed: unknown = JSON.parse(await readFile(fixturePath(source), "utf8"));
  if (!Array.isArray(parsed)) {
    throw new Error(`Fixture ${fixturePath(source)} is not an array`);
  }
  return parsed;
};

const collectSource = async (
  source: SourceId,
  collector: Collector,
  context: CollectorContext,
  isOffline: boolean,
): Promise<SourceReport> => {
  try {
    const rawItems: unknown[] = isOffline ? await readFixture(source) : await collector(context);
    const results = rawItems.map((rawItem) => itemSchema.safeParse(rawItem));
    const items = results.flatMap((result) => (result.success ? [result.data] : []));
    const firstFailure = results.find((result) => !result.success);
    if (!isOffline) {
      await writeFile(fixturePath(source), toPrettyJson(items));
    }
    return {
      source,
      items,
      invalidCount: results.length - items.length,
      firstIssue: firstFailure?.error?.issues[0]?.message,
    };
  } catch (error) {
    return { source, items: [], invalidCount: 0, error: error instanceof Error ? error.message : String(error) };
  }
};

const printReport = (reports: readonly SourceReport[]): void => {
  reports.forEach(({ source, items, invalidCount, firstIssue, error }) => {
    const label = source.padEnd(14);
    if (error) {
      console.log(`${label} FAILED  ${error}`);
      return;
    }
    const invalid = invalidCount > 0 ? `  (${invalidCount} invalid, e.g. ${firstIssue})` : "";
    console.log(`${label} ${String(items.length).padStart(5)} items${invalid}`);
  });
};

const main = async (): Promise<void> => {
  loadEnvFileIfPresent();
  const isOffline = process.argv.includes("--offline");
  const profile = await loadProfile();
  const context: CollectorContext = { profile, fetchedAt: toPragueIso(new Date()) };
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(FIXTURES_DIR, { recursive: true });

  const reports = await Promise.all(
    COLLECTORS.map(([source, collector]) => collectSource(source, collector, context, isOffline)),
  );
  printReport(reports);

  const itemsById = new Map(reports.flatMap((report) => report.items).map((item) => [item.id, item]));
  await writeCollectedItems({ collectedAt: context.fetchedAt, isOffline, items: [...itemsById.values()] });
  console.log(`\n${itemsById.size} unique items -> ${ITEMS_PATH}${isOffline ? " (offline fixtures)" : ""}`);

  if (reports.every((report) => report.error)) {
    process.exitCode = 1;
  }
};

await main();
