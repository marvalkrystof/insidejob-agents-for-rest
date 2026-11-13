import { HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { describeError } from "../libs/error.utils";
import { formatDateTimeLabel } from "../libs/time.utils";
import { invokeStructured } from "../llm/featherless";
import type { Candidate } from "../pipeline/filter";
import type { Profile } from "../profile";
import type { CommutePlan } from "../route/commute";
import { toComposeFacts } from "./compose-facts";
import { checkDigest, describeIssue, type FactContext, type FactIssue } from "./fact-check";
import { buildPlainDigest, replaceWithPlainLines } from "./plain-digest";
import { DIGEST_COMPOSITION_PROMPT, DIGEST_REPAIR_PROMPT, NOTICE_EXTRACTION_PROMPT } from "./prompts";
import {
  composedDigestSchema,
  noticeExtractionSchema,
  type ComposedDigest,
  type DigestComposer,
  type DigestEntry,
} from "./schema";
import { selectDigestEntries, type NoticeSummary } from "./select";

const DIGEST_TOOL_NAME = "submit_digest";
const MAX_REPAIR_ATTEMPTS = 1;

const DigestState = Annotation.Root({
  profile: Annotation<Profile>,
  commute: Annotation<CommutePlan>,
  candidates: Annotation<Candidate[]>,
  seenIds: Annotation<string[]>,
  now: Annotation<string>,
  useLlm: Annotation<boolean>,
  noticeSummaries: Annotation<Record<string, NoticeSummary>>,
  entries: Annotation<DigestEntry[]>,
  digest: Annotation<ComposedDigest>,
  composer: Annotation<DigestComposer>,
  issues: Annotation<FactIssue[]>,
  checkIssues: Annotation<string[]>,
  repairAttempts: Annotation<number>,
});

type DigestGraphState = typeof DigestState.State;
type DigestGraphUpdate = typeof DigestState.Update;

const extractNotices = async (state: DigestGraphState): Promise<DigestGraphUpdate> => {
  const notices = state.candidates.filter(({ item }) => item.type === "notice");
  if (!state.useLlm || notices.length === 0) {
    return { noticeSummaries: {} };
  }
  try {
    const extraction = await invokeStructured(noticeExtractionSchema, "submit_notice_classification", [
      new SystemMessage(NOTICE_EXTRACTION_PROMPT),
      new HumanMessage(
        JSON.stringify({
          homeMunicipality: state.profile.home.municipality,
          notices: notices.map(({ item }, index) => ({ index, title: item.title, documents: item.evidence ?? "" })),
        }),
      ),
    ]);
    const noticeSummaries: Record<string, NoticeSummary> = {};
    extraction.notices.forEach(({ index, summary, affectsResidents }) => {
      const notice = notices[index];
      if (notice) {
        noticeSummaries[notice.item.id] = { summary, affectsResidents };
      }
    });
    return { noticeSummaries };
  } catch (error) {
    // Selection needs the affectsResidents flag, so without it no notice is shown rather than unfiltered ones.
    console.warn(`[digest] notice extraction failed (${describeError(error)}); notices are left out`);
    return { noticeSummaries: {} };
  }
};

const selectEntries = (state: DigestGraphState): DigestGraphUpdate => ({
  entries: selectDigestEntries({
    profile: state.profile,
    commute: state.commute,
    candidates: state.candidates,
    noticeSummaries: state.noticeSummaries,
    seenIds: new Set(state.seenIds),
    now: new Date(state.now),
  }),
});

/** B9 guard: unknown refs are dropped, and a bullet survives only if it still cites an entry that exists. */
const keepCitedBullets = (digest: ComposedDigest, entries: readonly DigestEntry[]): ComposedDigest => {
  const knownRefs = new Set(entries.map((entry) => entry.ref));
  return {
    headline: digest.headline,
    headlineRefs: digest.headlineRefs.filter((ref) => knownRefs.has(ref)),
    sections: digest.sections
      .map((section) => ({
        ...section,
        bullets: section.bullets
          .map((bullet) => ({ ...bullet, refs: bullet.refs.filter((ref) => knownRefs.has(ref)) }))
          .filter((bullet) => bullet.refs.length > 0),
      }))
      .filter((section) => section.bullets.length > 0),
  };
};

const buildComposePayload = (state: DigestGraphState) => ({
  now: formatDateTimeLabel(new Date(state.now)),
  commuter: {
    homeMunicipality: state.profile.home.municipality,
    work: state.profile.work.label,
    interests: state.profile.interests,
  },
  entries: state.entries.map(toComposeFacts),
});

const buildComposeMessages = (state: DigestGraphState): BaseMessage[] => [
  new SystemMessage(DIGEST_COMPOSITION_PROMPT),
  new HumanMessage(JSON.stringify(buildComposePayload(state))),
];

const buildFactContext = (state: DigestGraphState): FactContext => {
  const { now, commuter } = buildComposePayload(state);
  return { globalFacts: [now, commuter.homeMunicipality, commuter.work].join("\n"), currentYear: state.now.slice(0, 4) };
};

const composePlain = (state: DigestGraphState): DigestGraphUpdate => ({
  digest: buildPlainDigest(state.entries),
  composer: "fallback",
  issues: [],
  checkIssues: [],
});

const compose = async (state: DigestGraphState): Promise<DigestGraphUpdate> => {
  if (!state.useLlm) {
    return composePlain(state);
  }
  try {
    const draft = await invokeStructured(composedDigestSchema, DIGEST_TOOL_NAME, buildComposeMessages(state));
    return { digest: keepCitedBullets(draft, state.entries), composer: "llm", repairAttempts: 0 };
  } catch (error) {
    console.warn(`[digest] composition failed (${describeError(error)}); sending the plain digest`);
    return composePlain(state);
  }
};

const factCheck = (state: DigestGraphState): DigestGraphUpdate => {
  const issues = checkDigest(state.digest, state.entries, buildFactContext(state));
  return state.repairAttempts === 0 ? { issues, checkIssues: issues.map(describeIssue) } : { issues };
};

const repair = async (state: DigestGraphState): Promise<DigestGraphUpdate> => {
  const repairAttempts = state.repairAttempts + 1;
  try {
    const problems = state.issues.map(describeIssue).join("\n");
    const repaired = await invokeStructured(composedDigestSchema, DIGEST_TOOL_NAME, [
      ...buildComposeMessages(state),
      new HumanMessage(`${DIGEST_REPAIR_PROMPT}\n\nYour digest:\n${JSON.stringify(state.digest)}\n\nProblems:\n${problems}`),
    ]);
    return { digest: keepCitedBullets(repaired, state.entries), repairAttempts };
  } catch (error) {
    console.warn(`[digest] repair failed (${describeError(error)}); failing claims become plain lines`);
    return { repairAttempts };
  }
};

const replaceFailing = (state: DigestGraphState): DigestGraphUpdate => ({
  digest: replaceWithPlainLines(state.digest, state.issues, state.entries),
});

const routeAfterCompose = (state: DigestGraphState): "factCheck" | typeof END =>
  state.composer === "llm" ? "factCheck" : END;

const routeAfterCheck = (state: DigestGraphState): "repair" | "replaceFailing" | typeof END => {
  if (state.issues.length === 0) {
    return END;
  }
  return state.repairAttempts < MAX_REPAIR_ATTEMPTS ? "repair" : "replaceFailing";
};

export const buildDigestGraph = () =>
  new StateGraph(DigestState)
    .addNode("extractNotices", extractNotices)
    .addNode("selectEntries", selectEntries)
    .addNode("compose", compose)
    .addNode("factCheck", factCheck)
    .addNode("repair", repair)
    .addNode("replaceFailing", replaceFailing)
    .addEdge(START, "extractNotices")
    .addEdge("extractNotices", "selectEntries")
    .addEdge("selectEntries", "compose")
    .addConditionalEdges("compose", routeAfterCompose, ["factCheck", END])
    .addConditionalEdges("factCheck", routeAfterCheck, ["repair", "replaceFailing", END])
    .addEdge("repair", "factCheck")
    .addEdge("replaceFailing", END)
    .compile({ checkpointer: new MemorySaver() });
