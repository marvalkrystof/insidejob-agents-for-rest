import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { truncate } from "./libs/text.utils";

type FeatureStatus = "built" | "partial" | "not built";

interface FeatureRow {
  lineNumber: number;
  feature: string;
  priority: string;
  status: string;
  code: string;
}

interface Findings {
  errors: string[];
  warnings: string[];
}

const FEATURES_PATH = "FEATURES.md";
const PACKAGE_JSON_PATH = "package.json";
const TABLE_HEADER = "| Feature | Priority | Status | Code |";
const FEATURE_HEADER_CELL = "Feature";
const TABLE_ROW_PREFIX = "|";
const SEPARATOR_PREFIX = "|---";
const PARTIAL_PREFIX = "partial: ";
const YARN_PREFIX = "yarn ";
const PRIORITIES: ReadonlySet<string> = new Set(["MVP", "V2", "V3", "idea"]);
const CODE_REFERENCE_PATTERN = /`([^`]+)`/g;
const FEATURE_LABEL_MAX_LENGTH = 60;

const packageJsonSchema = z.object({ scripts: z.record(z.string(), z.string()) });

const splitCells = (line: string): string[] =>
  line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());

/** Rows of every table whose header is exactly TABLE_HEADER; a differently spelled feature header is an error. */
const readFeatureTables = (lines: readonly string[]): { rows: FeatureRow[]; headerErrors: string[] } => {
  const rows: FeatureRow[] = [];
  const headerErrors: string[] = [];
  let isInFeatureTable = false;
  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const lineNumber = index + 1;
    if (!line.startsWith(TABLE_ROW_PREFIX)) {
      isInFeatureTable = false;
      return;
    }
    if (splitCells(line)[0] === FEATURE_HEADER_CELL) {
      isInFeatureTable = line === TABLE_HEADER;
      if (!isInFeatureTable) {
        headerErrors.push(`line ${lineNumber}: a feature table header must be "${TABLE_HEADER}"`);
      }
      return;
    }
    if (isInFeatureTable && !line.startsWith(SEPARATOR_PREFIX)) {
      const [feature = "", priority = "", status = "", code = ""] = splitCells(line);
      rows.push({ lineNumber, feature, priority, status, code });
    }
  });
  return { rows, headerErrors };
};

const parseStatus = (cell: string): FeatureStatus | undefined => {
  if (cell === "built" || cell === "not built") {
    return cell;
  }
  return cell.startsWith(PARTIAL_PREFIX) && cell.length > PARTIAL_PREFIX.length ? "partial" : undefined;
};

const readCodeReferences = (cell: string): string[] =>
  [...cell.matchAll(CODE_REFERENCE_PATTERN)].flatMap((match) => (match[1] ? [match[1]] : []));

/** A `yarn <script> …` reference must name a package.json script; anything else is a path from the repo root. */
const isReferencePresent = (reference: string, scripts: Readonly<Record<string, string>>): boolean => {
  if (!reference.startsWith(YARN_PREFIX)) {
    return existsSync(reference);
  }
  const scriptName = reference.slice(YARN_PREFIX.length).split(" ")[0] ?? "";
  return scriptName in scripts;
};

const checkRow = (row: FeatureRow, scripts: Readonly<Record<string, string>>): Findings => {
  const label = `line ${row.lineNumber} (${truncate(row.feature, FEATURE_LABEL_MAX_LENGTH)})`;
  const errors: string[] = [];
  if (!PRIORITIES.has(row.priority)) {
    errors.push(`${label}: priority "${row.priority}" must be one of ${[...PRIORITIES].join(", ")}`);
  }
  const status = parseStatus(row.status);
  if (!status) {
    return { errors: [...errors, `${label}: status "${row.status}" must be "built", "partial: <gap>" or "not built"`], warnings: [] };
  }
  const references = readCodeReferences(row.code);
  if (status === "not built") {
    const warnings = references
      .filter((reference) => isReferencePresent(reference, scripts))
      .map((reference) => `${label}: marked not built, but ${reference} exists`);
    return { errors, warnings };
  }
  if (references.length === 0) {
    errors.push(`${label}: a ${status} feature needs at least one code reference`);
  }
  references
    .filter((reference) => !isReferencePresent(reference, scripts))
    .forEach((reference) => errors.push(`${label}: ${reference} does not exist`));
  return { errors, warnings: [] };
};

const findDuplicateFeatures = (rows: readonly FeatureRow[]): string[] =>
  [...Map.groupBy(rows, (row) => row.feature.toLowerCase()).values()]
    .filter((group) => group.length > 1)
    .map((group) => `duplicate feature on lines ${group.map((row) => row.lineNumber).join(", ")}: ${group[0]?.feature ?? ""}`);

const main = async (): Promise<void> => {
  const lines = (await readFile(FEATURES_PATH, "utf8")).split("\n");
  const { scripts } = packageJsonSchema.parse(JSON.parse(await readFile(PACKAGE_JSON_PATH, "utf8")));
  const { rows, headerErrors } = readFeatureTables(lines);
  const findings = rows.map((row) => checkRow(row, scripts));
  const errors = [
    ...(rows.length === 0 ? [`${FEATURES_PATH}: no feature tables found`] : []),
    ...headerErrors,
    ...findDuplicateFeatures(rows),
    ...findings.flatMap((finding) => finding.errors),
  ];
  findings.flatMap((finding) => finding.warnings).forEach((warning) => console.warn(`WARN  ${warning}`));
  errors.forEach((error) => console.error(`ERROR ${error}`));
  const countsByStatus = Map.groupBy(rows, (row) => parseStatus(row.status) ?? "invalid");
  const summary = [...countsByStatus].map(([status, group]) => `${group.length} ${status}`).join(", ");
  console.log(`${rows.length} features: ${summary}`);
  if (errors.length > 0) {
    process.exitCode = 1;
  }
};

await main();
