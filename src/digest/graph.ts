import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { formatDateTimeLabel } from "../libs/time.utils";
import { invokeStructured } from "../llm/featherless";
import type { Candidate } from "../pipeline/filter";
import type { Profile } from "../profile";
import type { CommutePlan } from "../route/commute";
import { DIGEST_COMPOSITION_PROMPT, NOTICE_EXTRACTION_PROMPT } from "./prompts";
import { composedDigestSchema, noticeExtractionSchema, type ComposedDigest, type DigestEntry } from "./schema";
import { selectDigestEntries, type NoticeSummary } from "./select";

const DigestState = Annotation.Root({
  profile: Annotation<Profile>,
  commute: Annotation<CommutePlan>,
  candidates: Annotation<Candidate[]>,
  seenIds: Annotation<string[]>,
  now: Annotation<string>,
  noticeSummaries: Annotation<Record<string, NoticeSummary>>,
  entries: Annotation<DigestEntry[]>,
  digest: Annotation<ComposedDigest>,
});

type DigestGraphState = typeof DigestState.State;
type DigestGraphUpdate = typeof DigestState.Update;

const extractNotices = async (state: DigestGraphState): Promise<DigestGraphUpdate> => {
  const notices = state.candidates.filter(({ item }) => item.type === "notice");
  if (notices.length === 0) {
    return { noticeSummaries: {} };
  }
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

/** B9 guard: a bullet survives only if it cites at least one entry that really exists. */
const keepCitedBullets = (digest: ComposedDigest, entries: readonly DigestEntry[]): ComposedDigest => {
  const knownRefs = new Set(entries.map((entry) => entry.ref));
  return {
    headline: digest.headline,
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

// Free-text Czech details of closures, transit changes and notices led the model to embellish when translating;
// for those sources it gets only title, day, when and reason, and readers follow the [n] link for specifics.
const SOURCES_WITH_STRUCTURED_DETAILS = new Set<DigestEntry["source"]>(["tomtom", "cez", "goout", "biooko"]);

// A notice-board time range is the posting period, which the model restated as the duration of the works;
// notices therefore reach the model without day and when (the web page still shows the labelled posting period).
const toComposeFacts = ({ itemId: _itemId, url: _url, details, day, when, ...facts }: DigestEntry) => ({
  ...facts,
  ...(SOURCES_WITH_STRUCTURED_DETAILS.has(facts.source) ? { details } : {}),
  ...(facts.source === "uredni-deska" ? {} : { day, when }),
});

const compose = async (state: DigestGraphState): Promise<DigestGraphUpdate> => {
  const payload = {
    now: formatDateTimeLabel(new Date(state.now)),
    commuter: {
      homeMunicipality: state.profile.home.municipality,
      work: state.profile.work.label,
      interests: state.profile.interests,
    },
    entries: state.entries.map(toComposeFacts),
  };
  const digest = await invokeStructured(composedDigestSchema, "submit_digest", [
    new SystemMessage(DIGEST_COMPOSITION_PROMPT),
    new HumanMessage(JSON.stringify(payload)),
  ]);
  return { digest: keepCitedBullets(digest, state.entries) };
};

export const buildDigestGraph = () =>
  new StateGraph(DigestState)
    .addNode("extractNotices", extractNotices)
    .addNode("selectEntries", selectEntries)
    .addNode("compose", compose)
    .addEdge(START, "extractNotices")
    .addEdge("extractNotices", "selectEntries")
    .addEdge("selectEntries", "compose")
    .addEdge("compose", END)
    .compile({ checkpointer: new MemorySaver() });
