import * as cheerio from "cheerio";

const ELLIPSIS = "…";
const BLOCK_BOUNDARY_PATTERN = /<(?:br|\/p|\/div|\/li|\/tr|\/td|\/h\d)\b[^>]*>/gi;

export const escapeHtml = (text: string): string =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const collapseWhitespace =(text: string): string => text.replace(/\s+/g, " ").trim();

/** Decodes entities as well; some sources (Bio Oko) escape their HTML twice, hence `passes`. */
export const htmlToText = (html: string, passes = 1): string => {
  let text = html;
  for (let pass = 0; pass < passes; pass += 1) {
    text = cheerio.load(text.replace(BLOCK_BOUNDARY_PATTERN, " ")).root().text();
  }
  return collapseWhitespace(text);
};

export const truncate = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
};
