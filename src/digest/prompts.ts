import { DIGEST_SECTIONS, DIGEST_SECTION_TITLES } from "./schema";

export const NOTICE_EXTRACTION_PROMPT = `You classify notices from a Czech municipal notice board for a resident.
You receive JSON with the resident's home municipality and a list of notices (index, Czech title, attached document names).
For every notice return an object with:
- index: the notice index you received
- category: one of road_closure, construction, utilities, bylaw, other
- street: the affected street in the home municipality, or null when none is named
- affectsResidents: true only if the notice concerns the home municipality and could change a resident's day (closures, works, utility interruptions, new local rules)
- summary: one plain English sentence (max 20 words) saying what happens, where and when, using only facts present in the title or document names
Never include names of private persons. Never invent dates or places.
Respond with a single JSON object of the form {"notices": [ ... ]}.`;

export const DIGEST_COMPOSITION_PROMPT = `You write a short morning digest for a commuter who lives in a Czech town and drives to a park-and-ride, then takes public transport to work.
You receive JSON with the commuter profile and numbered entries. Each entry has a ref number, a section, facts and a reason it was selected.
Rules:
- Write in plain, friendly English. Translate Czech titles; keep Czech street and place names.
- Use only facts present in the entries. Never invent times, places, prices or causes.
- Do not generalize or add specifics (directions, lane counts, line numbers, places) that the cited entry does not state; when in doubt, say less. Never move a detail from one entry to a bullet citing another.
- When entries have different dates or times, give each entry its own bullet, or state each entry's own date or time.
- Write numbers as digits.
- Quote clock times exactly as in "when" (e.g. "11:30–15:00"); do not turn them into "morning" or "afternoon". State the departure comparison as entry 1's reason gives it.
- Refer to dates only through each entry's "day" value ("today", "tomorrow", "ongoing" or a weekday with date) and its "when". Say "today" or "tonight" only for entries whose day is "today". The current time is given as "now".
- Every bullet must cite the entries it is based on in "refs" (ref numbers). Do not put URLs in the text.
- The commute section starts with the departure recommendation from entry 1, then disruptions on the drive and on public transport lines.
- Sections, in this order when they have entries: ${DIGEST_SECTIONS.map((section) => `${section} ("${DIGEST_SECTION_TITLES[section]}")`).join(", ")}.
- Mention entries marked isNew=false only if they still matter today, and keep them brief.
- Never mention names of private persons.
- headline: one sentence that tells the story of the day (the most important thing first); headlineRefs: the ref numbers of the entries the headline is based on.
- Keep the whole digest under 1200 characters; at most 4 bullets per section.
Respond with a single JSON object of the form {"headline": string, "headlineRefs": number[], "sections": [{"section": "commute" | "home" | "town" | "events", "title": string, "bullets": [{"text": string, "refs": number[]}]}]}.`;

export const DIGEST_REPAIR_PROMPT = `An automatic check found claims in your digest that the cited entries do not support; they are listed under "Problems".
Return the complete digest again as the same JSON object. Fix only the headline and the bullets listed: correct or remove each unsupported time, date, weekday or number using only the entries that text cites, and give entries with different dates or times their own bullets. Keep every other bullet exactly as it is.`;
