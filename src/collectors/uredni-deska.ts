import { z } from "zod";
import { buildItem } from "../item";
import { fetchJson } from "../libs/http.utils";
import { truncate } from "../libs/text.utils";
import { parsePragueEndOfDay, parsePragueWallClock, toPragueIso } from "../libs/time.utils";
import { mapRecordsSafely } from "./collector.utils";
import type { Collector } from "./types";

const DATA_URL = "https://www.mestokladno.cz/opendata-uredni-deska";
const EVIDENCE_MAX_LENGTH = 300;

// Tuned on the board snapshot during the spike (.spikes/uredni-deska/scripts/prefilter.py).
const RELEVANCE_RULES: ReadonlyArray<{ tag: string; pattern: RegExp }> = [
  {
    tag: "traffic",
    pattern: /stanoven|P[ÚU]PPK|M[ÚU]PPK|uzav[íi]rk|p[řr]echodn[éa] [úu]prav|\bDIO\b|dopravn[íi] opat[řr]en|objízd|náhradní autobusov|zábor/i,
  },
  {
    tag: "construction",
    pattern: /SMKL\/.*\/OV|povolen[íi] stavby|stavebn[íi]|územní[ho]* plán|[ÚU]zemn[íi]ho pl[áa]nu|JEDNOTN[ÉE] ENVIRONMENT|\bJES\b|z[áa]m[ěe]r:|řízen[íi]|novostavb|vyrozum[ěe]n[íi] o zah[áa]jen|Zásad územního rozvoje|\bSEA\b|\bEIA\b/i,
  },
  {
    tag: "utilities",
    pattern: /odst[áa]vk|p[řr]eru[šs]en[íi] dod[áa]vk|svoz|komun[áa]ln[íi] odpad|vodovod|kanaliza|plyn|elektři|elektrick|ČEZ|transform/i,
  },
  { tag: "bylaw", pattern: /obecn[ěe] z[áa]vazn|pr[áa]vn[íi]ho p[řr]edpisu|obec\. z[áa]vaz/i },
];
const NOISE_PATTERN =
  /exekutor|dra[žz]b|rozpo[čc]t|z[áa]v[ěe]re[čc]n[ée]ho? [úu][čc]tu|volb|volebn|ztr[áa]t a n[áa]lez|uložen[íi] p[íi]semnosti|p[řr]evzet[íi] p[íi]semnosti|Okresn[íi] soud|Oznamovatel|pron[áa]jem|prodej|vozidl|zasedání ZM|schůze RM|Zpráva ze|referend|hledáme|Ceník/i;
// Board titles of other municipalities in the Kladno ORP start with their name, e.g. "Libušín - ...".
const LEADING_MUNICIPALITY_PATTERN = /^([^-–]+?)\s+[-–]\s/;

const localizedTextSchema = z.object({ cs: z.string() });
const dateSchema = z.object({ datum: z.string() });
const entrySchema = z.object({
  url: z.string().url(),
  název: localizedTextSchema,
  vyvěšení: dateSchema.optional(),
  relevantní_do: z.union([dateSchema, z.object({ nespecifikovaný: z.boolean() })]).optional(),
  dokument: z.array(z.object({ název: localizedTextSchema })).default([]),
});
const boardSchema = z.object({ informace: z.array(z.unknown()) });

const isAboutHomeMunicipality = (title: string, homeNames: readonly string[]): boolean => {
  const normalizedTitle = title.toLocaleLowerCase("cs");
  if (homeNames.some((name) => normalizedTitle.includes(name.toLocaleLowerCase("cs")))) {
    return true;
  }
  return !LEADING_MUNICIPALITY_PATTERN.test(title);
};

export const collectMunicipalBoard: Collector = async ({ profile, fetchedAt }) => {
  const board = boardSchema.parse(await fetchJson(DATA_URL));
  const homeNames = [profile.home.municipality, ...profile.home.municipalityParts];
  return mapRecordsSafely(
    board.informace,
    (record) => {
      const entry = entrySchema.parse(record);
      const title = entry.název.cs;
      const documentNames = entry.dokument.map((document) => document.název.cs).join("; ");
      if (NOISE_PATTERN.test(title) || !isAboutHomeMunicipality(title, homeNames)) {
        return undefined;
      }
      const tags = RELEVANCE_RULES.filter(({ pattern }) => pattern.test(`${title}; ${documentNames}`)).map(({ tag }) => tag);
      if (tags.length === 0) {
        return undefined;
      }
      const relevantTo = entry.relevantní_do && "datum" in entry.relevantní_do ? entry.relevantní_do.datum : undefined;
      return buildItem({
        source: "uredni-deska",
        sourceKey: entry.url,
        type: "notice",
        title,
        geo: { municipality: profile.home.municipality },
        timeRange: entry.vyvěšení
          ? {
              from: toPragueIso(parsePragueWallClock(entry.vyvěšení.datum)),
              to: relevantTo ? toPragueIso(parsePragueEndOfDay(relevantTo)) : undefined,
            }
          : undefined,
        url: entry.url,
        fetchedAt,
        confidence: "official",
        severity: "low",
        tags,
        evidence: documentNames ? truncate(documentNames, EVIDENCE_MAX_LENGTH) : undefined,
      });
    },
    "uredni-deska",
  );
};
