import { escapeHtml } from "../libs/text.utils";
import type { StoredDigest } from "./schema";

/** Telegram HTML parse mode: every citation becomes a link to its source. */
export const renderTelegramHtml = ({ digest, entries }: StoredDigest): string => {
  const urlByRef = new Map(entries.map((entry) => [entry.ref, entry.url]));
  const lines = [`<b>${escapeHtml(digest.headline)}</b>`];
  digest.sections.forEach((section) => {
    lines.push("", `<b>${escapeHtml(section.title)}</b>`);
    section.bullets.forEach((bullet) => {
      const links = bullet.refs.map((ref) => `<a href="${escapeHtml(urlByRef.get(ref) ?? "")}">[${ref}]</a>`).join(" ");
      lines.push(`• ${escapeHtml(bullet.text)} ${links}`);
    });
  });
  return lines.join("\n");
};

export const renderPlainText = ({ digest, entries }: StoredDigest): string => {
  const lines = [digest.headline];
  digest.sections.forEach((section) => {
    lines.push("", section.title);
    section.bullets.forEach((bullet) => {
      lines.push(`  • ${bullet.text} ${bullet.refs.map((ref) => `[${ref}]`).join("")}`);
    });
  });
  lines.push("", "Sources:");
  entries.forEach((entry) => {
    lines.push(`  [${entry.ref}] ${entry.title.slice(0, 70)} (${entry.source}, ${entry.confidence}) ${entry.url}`);
  });
  return lines.join("\n");
};
