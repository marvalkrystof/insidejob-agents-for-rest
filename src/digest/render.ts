import { escapeHtml } from "../libs/text.utils";
import type { StoredDigest } from "./schema";

export const PLAIN_DIGEST_NOTE = "Plain digest: the language model was unavailable.";

/** Telegram HTML parse mode: every citation becomes a link to its source. */
export const renderTelegramHtml = ({ digest, entries, composer }: StoredDigest): string => {
  const urlByRef = new Map(entries.map((entry) => [entry.ref, entry.url]));
  const renderLinks = (refs: readonly number[]): string =>
    refs.map((ref) => ` <a href="${escapeHtml(urlByRef.get(ref) ?? "")}">[${ref}]</a>`).join("");
  const lines = [`<b>${escapeHtml(digest.headline)}</b>${renderLinks(digest.headlineRefs)}`];
  if (composer === "fallback") {
    lines.push(`<i>${PLAIN_DIGEST_NOTE}</i>`);
  }
  digest.sections.forEach((section) => {
    lines.push("", `<b>${escapeHtml(section.title)}</b>`);
    section.bullets.forEach((bullet) => {
      lines.push(`• ${escapeHtml(bullet.text)}${renderLinks(bullet.refs)}`);
    });
  });
  return lines.join("\n");
};

const renderPlainRefs = (refs: readonly number[]): string => refs.map((ref) => `[${ref}]`).join("");

export const renderPlainText = ({ digest, entries, composer }: StoredDigest): string => {
  const lines = [`${digest.headline} ${renderPlainRefs(digest.headlineRefs)}`.trimEnd()];
  if (composer === "fallback") {
    lines.push(PLAIN_DIGEST_NOTE);
  }
  digest.sections.forEach((section) => {
    lines.push("", section.title);
    section.bullets.forEach((bullet) => {
      lines.push(`  • ${bullet.text} ${renderPlainRefs(bullet.refs)}`);
    });
  });
  lines.push("", "Sources:");
  entries.forEach((entry) => {
    lines.push(`  [${entry.ref}] ${entry.title.slice(0, 70)} (${entry.source}, ${entry.confidence}) ${entry.url}`);
  });
  return lines.join("\n");
};
