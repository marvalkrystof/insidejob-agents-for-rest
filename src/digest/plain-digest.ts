import type { FactIssue } from "./fact-check";
import { DIGEST_SECTIONS, DIGEST_SECTION_TITLES, type ComposedDigest, type DigestEntry } from "./schema";

type DigestBullet = ComposedDigest["sections"][number]["bullets"][number];

const COMMUTE_SOURCE = "tomtom";
const GENERIC_HEADLINE = "Your Domovník digest";
const REASON_CLAUSE_SEPARATOR = ";";

export const toPlainBullet = (entry: DigestEntry): DigestBullet => {
  if (entry.source === COMMUTE_SOURCE) {
    return { text: entry.reason, refs: [entry.ref] };
  }
  const text = entry.summary ?? entry.title;
  return { text: entry.when ? `${text} (${entry.when})` : text, refs: [entry.ref] };
};

/** The departure recommendation, i.e. the first clause of the commute entry's reason. */
const buildPlainHeadline = (entries: readonly DigestEntry[]): Pick<ComposedDigest, "headline" | "headlineRefs"> => {
  const commute = entries.find((entry) => entry.source === COMMUTE_SOURCE);
  if (!commute) {
    return { headline: GENERIC_HEADLINE, headlineRefs: [] };
  }
  return { headline: commute.reason.split(REASON_CLAUSE_SEPARATOR)[0] ?? commute.reason, headlineRefs: [commute.ref] };
};

/** A digest built from the entries alone, for when the LLM is unavailable or switched off. */
export const buildPlainDigest = (entries: readonly DigestEntry[]): ComposedDigest => ({
  ...buildPlainHeadline(entries),
  sections: DIGEST_SECTIONS.flatMap((section) => {
    const bullets = entries.filter((entry) => entry.section === section).map(toPlainBullet);
    return bullets.length > 0 ? [{ section, title: DIGEST_SECTION_TITLES[section], bullets }] : [];
  }),
});

/** Claims that still fail the fact check after the repair become one plain line per cited entry. */
export const replaceWithPlainLines = (
  digest: ComposedDigest,
  issues: readonly FactIssue[],
  entries: readonly DigestEntry[],
): ComposedDigest => {
  const entriesByRef = new Map(entries.map((entry) => [entry.ref, entry]));
  const isFailingBullet = (sectionIndex: number, bulletIndex: number): boolean =>
    issues.some(
      ({ location }) => location !== "headline" && location.sectionIndex === sectionIndex && location.bulletIndex === bulletIndex,
    );
  const hasFailingHeadline = issues.some(({ location }) => location === "headline");
  return {
    ...digest,
    ...(hasFailingHeadline ? buildPlainHeadline(entries) : {}),
    sections: digest.sections.map((section, sectionIndex) => ({
      ...section,
      bullets: section.bullets.flatMap((bullet, bulletIndex) => {
        if (!isFailingBullet(sectionIndex, bulletIndex)) {
          return [bullet];
        }
        return bullet.refs.flatMap((ref) => {
          const entry = entriesByRef.get(ref);
          return entry ? [toPlainBullet(entry)] : [];
        });
      }),
    })),
  };
};
