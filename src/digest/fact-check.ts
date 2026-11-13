import { toComposeFacts, type ComposeFacts } from "./compose-facts";
import type { ComposedDigest, DigestEntry } from "./schema";

export type FactLocation = "headline" | { sectionIndex: number; bulletIndex: number };

export interface FactIssue {
  location: FactLocation;
  text: string;
  refs: number[];
  problems: string[];
}

export interface FactContext {
  /** What the composer was told besides the entries: the current time and the commuter. */
  globalFacts: string;
  currentYear: string;
}

interface DateClaim {
  /** Day and month, e.g. "20 Nov". */
  key: string;
  label: string;
  year?: string;
}

interface Claims {
  clocks: string[];
  dates: DateClaim[];
  weekdays: string[];
  numbers: string[];
}

interface FactPool {
  clocks: ReadonlySet<string>;
  dateKeys: ReadonlySet<string>;
  weekdays: ReadonlySet<string>;
  numbers: ReadonlySet<string>;
}

const BLANK = " ";
const MONTH = "(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const ORDINAL = "(?:st|nd|rd|th)?";
const YEAR = "(?:,?\\s+(\\d{4})\\b)?";
const DAY_FIRST_DATE_PATTERN = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+${MONTH}\\b\\.?${YEAR}`, "g");
const MONTH_FIRST_DATE_PATTERN = new RegExp(`\\b${MONTH}\\.?\\s+(\\d{1,2})${ORDINAL}\\b${YEAR}`, "g");
const CLOCK_PATTERN = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
const WEEKDAY_PATTERN = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:[a-z]*day|s|rs)?\b/g;
const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
const CITATION_PATTERN = /\[\d+\]/g;
const TODAY_PATTERN = /\b(?:today|tonight|this (?:morning|afternoon|evening))\b/i;
const TOMORROW_PATTERN = /\btomorrow\b/i;

const normalizeNumber = (raw: string): string => String(Number(raw));

const toDateClaim = (label: string, day: string, month: string, year: string | undefined): DateClaim => ({
  key: `${Number(day)} ${month.slice(0, 3)}`,
  label: label.trim(),
  year,
});

const takeAll = (text: string, pattern: RegExp): { matches: RegExpMatchArray[]; rest: string } => ({
  matches: [...text.matchAll(pattern)],
  rest: text.replace(pattern, BLANK),
});

/** Times are taken out before dates and dates before plain numbers, so "16 Nov, 11:30" yields no stray "16" or "11". */
const extractClaims = (rawText: string): Claims => {
  const clocks = takeAll(rawText.replace(CITATION_PATTERN, BLANK), CLOCK_PATTERN);
  const dayFirst = takeAll(clocks.rest, DAY_FIRST_DATE_PATTERN);
  const monthFirst = takeAll(dayFirst.rest, MONTH_FIRST_DATE_PATTERN);
  const weekdays = takeAll(monthFirst.rest, WEEKDAY_PATTERN);
  return {
    clocks: clocks.matches.map(([, hours = "", minutes = ""]) => `${hours.padStart(2, "0")}:${minutes}`),
    dates: [
      ...dayFirst.matches.map(([label = "", day = "", month = "", year]) => toDateClaim(label, day, month, year)),
      ...monthFirst.matches.map(([label = "", month = "", day = "", year]) => toDateClaim(label, day, month, year)),
    ],
    weekdays: weekdays.matches.map(([, weekday = ""]) => weekday),
    numbers: [...weekdays.rest.matchAll(NUMBER_PATTERN)].map(([number = ""]) => normalizeNumber(number)),
  };
};

const textsOf = (facts: ComposeFacts): string[] =>
  [facts.title, facts.summary, facts.day, facts.when, facts.reason, facts.details].filter((text): text is string => Boolean(text));

const buildPool = (texts: readonly string[], currentYear: string): FactPool => {
  const joined = texts.join("\n");
  const claims = extractClaims(joined);
  return {
    clocks: new Set(claims.clocks),
    // Dates without a year in the facts are in the current year (formatDayLabel omits it only then).
    dateKeys: new Set(claims.dates.flatMap((date) => [date.key, `${date.key} ${date.year ?? currentYear}`])),
    weekdays: new Set(claims.weekdays),
    // Lenient on purpose: any digit group in the facts counts, so "the 16th" matches "16 Nov".
    numbers: new Set([...joined.matchAll(NUMBER_PATTERN)].map(([number = ""]) => normalizeNumber(number))),
  };
};

const hasDate = (pool: FactPool, date: DateClaim): boolean =>
  pool.dateKeys.has(date.year ? `${date.key} ${date.year}` : date.key);

const notInEntries = (value: string, kind: string): string => `"${value}" (${kind}) is not in the cited entries`;

const checkRelativeDays = (text: string, cited: readonly ComposeFacts[]): string[] => [
  ...(TODAY_PATTERN.test(text) && !cited.some((facts) => facts.day === "today")
    ? ["says today or tonight, but no cited entry is today"]
    : []),
  ...(TOMORROW_PATTERN.test(text) && !cited.some((facts) => facts.day === "tomorrow")
    ? ["says tomorrow, but no cited entry is tomorrow"]
    : []),
];

/**
 * A bullet that states a time or date and cites several entries must state each entry's own,
 * otherwise one entry's date passes for all of them ("A and B until 27 Nov" when A ends 20 Nov).
 */
const checkAttribution = (claims: Claims, cited: readonly ComposeFacts[]): string[] => {
  if (cited.length < 2 || (claims.clocks.length === 0 && claims.dates.length === 0)) {
    return [];
  }
  const stated = new Set([...claims.clocks, ...claims.dates.map((date) => date.key)]);
  return cited.flatMap((facts) => {
    if (!facts.when) {
      return [];
    }
    const own = extractClaims(facts.when);
    const ownTokens = [...own.clocks, ...own.dates.map((date) => date.key)];
    return ownTokens.length > 0 && !ownTokens.some((token) => stated.has(token))
      ? [`[${facts.ref}] has its own date or time ("${facts.when}") that the text does not state`]
      : [];
  });
};

const checkText = (
  text: string,
  refs: readonly number[],
  factsByRef: ReadonlyMap<number, ComposeFacts>,
  context: FactContext,
  isBullet: boolean,
): string[] => {
  if (refs.length === 0) {
    return ["cites no entries"];
  }
  const cited = refs.flatMap((ref) => {
    const facts = factsByRef.get(ref);
    return facts ? [facts] : [];
  });
  const pool = buildPool([...cited.flatMap(textsOf), context.globalFacts], context.currentYear);
  const claims = extractClaims(text);
  const problems = [
    ...refs.filter((ref) => !factsByRef.has(ref)).map((ref) => `cites [${ref}], which does not exist`),
    ...claims.clocks.filter((clock) => !pool.clocks.has(clock)).map((clock) => notInEntries(clock, "time")),
    ...claims.dates.filter((date) => !hasDate(pool, date)).map((date) => notInEntries(date.label, "date")),
    ...claims.weekdays.filter((weekday) => !pool.weekdays.has(weekday)).map((weekday) => notInEntries(weekday, "weekday")),
    ...claims.numbers.filter((number) => !pool.numbers.has(number)).map((number) => notInEntries(number, "number")),
    ...checkRelativeDays(text, cited),
    // The headline sums up several entries in one sentence, so per-entry attribution applies to bullets only.
    ...(isBullet ? checkAttribution(claims, cited) : []),
  ];
  return [...new Set(problems)];
};

const toIssues = (location: FactLocation, text: string, refs: number[], problems: string[]): FactIssue[] =>
  problems.length > 0 ? [{ location, text, refs, problems }] : [];

/**
 * Every time, date, weekday and number in the headline and the bullets must come from the entries they cite
 * (as the composer saw them), and "today"/"tomorrow" must match a cited entry's day. Wording such as
 * "concert" is not checked.
 */
export const checkDigest = (digest: ComposedDigest, entries: readonly DigestEntry[], context: FactContext): FactIssue[] => {
  const factsByRef = new Map(entries.map((entry) => [entry.ref, toComposeFacts(entry)]));
  return [
    ...toIssues("headline", digest.headline, digest.headlineRefs, checkText(digest.headline, digest.headlineRefs, factsByRef, context, false)),
    ...digest.sections.flatMap((section, sectionIndex) =>
      section.bullets.flatMap((bullet, bulletIndex) =>
        toIssues({ sectionIndex, bulletIndex }, bullet.text, bullet.refs, checkText(bullet.text, bullet.refs, factsByRef, context, true)),
      ),
    ),
  ];
};

export const describeIssue = ({ location, text, refs, problems }: FactIssue): string =>
  `${location === "headline" ? "Headline" : "Bullet"} "${text}" (refs ${refs.join(", ") || "none"}): ${problems.join("; ")}`;
