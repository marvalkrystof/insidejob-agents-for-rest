// Přirozený popis cíle → job definition (konfigurace cíle podle WORKFLOW.md, sekce 3).
// Model přes Featherless sestaví návrh. Server ho zvaliduje, doplní výchozí hodnoty
// (normalizeGoal) a vrátí do formuláře; nic se nespouští, dokud to uživatel nepotvrdí.
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { MODE_LIMITS, normalizeGoal, type GoalConfig } from '../src/workflow/goal.ts';
import { FEATHERLESS_BASE_URL } from '../src/workflow/judge.ts';

export const COMPILER_MODEL = process.env.COMPILER_MODEL?.trim() || 'deepseek-ai/DeepSeek-V4.1-Flash-1017';

const nullable = <T extends z.ZodType>(t: T) => t.nullable().optional();
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/**
 * Co smí model vyplnit. Záměrně chybí reset_recommendations, dm_share_recipient
 * a control_account_id: ty smí nastavit jen člověk (sekce 3).
 */
const DraftSchema = z.object({
  target_topic: z.string().trim().min(1).max(60),
  target_description: z.string().trim().max(400).default(''),
  subtopics: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  old_topics: z.array(z.object({ topic: z.string().trim().min(1).max(60), description: z.string().trim().max(300).default('') })).max(8).default([]),
  languages: z.array(z.string().trim().min(2).max(5)).max(5).default([]),
  account_type: nullable(z.enum(['test', 'real'])),
  mode: nullable(z.enum(['fast', 'safe'])),
  run_mode: nullable(z.enum(['dry', 'live'])),
  target_alignment: nullable(z.number().min(0.2).max(0.9)),
  verify_persistence: nullable(z.boolean()),
  on_success: nullable(z.enum(['maintain', 'stop'])),
  seeds_enabled: nullable(z.boolean()),
  limits: z.object({
    max_cycles: nullable(z.number().int().min(1).max(50)),
    max_active_minutes: nullable(z.number().int().min(5).max(2000)),
    max_days: nullable(z.number().int().min(1).max(30)),
    max_cost_usd: nullable(z.number().min(0).max(100)),
    hard_stop_at: nullable(z.string()),
  }).partial().default({}),
  active_hours: nullable(z.object({ from: hhmm, to: hhmm })),
  assumptions: z.array(z.string().max(300)).max(10).default([]),
  questions: z.array(z.string().max(300)).max(6).default([]),
});
export type Draft = z.infer<typeof DraftSchema>;

export interface CompileResult {
  /** Plná konfigurace cíle po doplnění výchozích hodnot (bez goal_id, ten vznikne při uložení). */
  goal: Omit<GoalConfig, 'goal_id'>;
  /** Co doporučil model pro přepínač Jen sledovat / Naplno. */
  run_mode: 'dry' | 'live';
  assumptions: string[];
  questions: string[];
  /** Upozornění, která přidal server (pravidla, ne model). */
  warnings: string[];
  model: string;
  ms: number;
}

function localNow(tz: string) {
  const d = new Date();
  const fmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: tz, dateStyle: 'full', timeStyle: 'short' }).format(d);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const iso = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 16) + `${sign}${pad(off / 60)}:${pad(off % 60)}`;
  return { fmt, iso };
}

function systemPrompt(tz: string): string {
  const now = localNow(tz);
  const f = MODE_LIMITS.fast, s = MODE_LIMITS.safe;
  return [
    'Jsi kompilátor zadání pro agenta, který trénuje Instagram Reels feed uživatele: reels k cílovému tématu dokoukává a odměňuje, staré téma potlačuje.',
    'Z volného popisu uživatele sestav konfiguraci cíle. Odpověz POUZE jedním JSON objektem, bez markdownu a bez komentářů.',
    '',
    `Teď je ${now.fmt} (${now.iso}, časové pásmo ${tz}).`,
    '',
    'Pole JSONu:',
    '- target_topic: krátký název tématu, které chce vidět víc (1–3 slova, jazykem uživatele), např. "auta".',
    '- target_description: výčet toho, co do tématu patří, aby klasifikátor poznal i okrajové případy (čárkami, 5–15 položek).',
    '- subtopics: 6–12 konkrétních vyhledávacích dotazů a podtémat pro Instagram. Mix češtiny a angličtiny podle languages, krátké (1–3 slova), bez "#".',
    '- old_topics: témata, která chce vidět MÍŇ, každé {topic, description}. Prázdné pole, když nic takového neřekl.',
    '- languages: jazyky obsahu, výchozí ["cs","en"].',
    '- account_type: "test" jen když výslovně řekne testovací / nový / fake účet; "real" když mluví o svém účtu; null když to neřekl.',
    '- mode: "fast" (rychlé tempo, jen testovací účet) nebo "safe" (opatrné); null když neřekl.',
    '- run_mode: "live" (lajky, ukládání, sledování, hledání) jen když to výslovně chce ("naplno", "ať lajkuje", "ostře"); "dry" když chce jen zkusit / sledovat; jinak null. Neodvozuj to z toho, že chce feed změnit.',
    '- target_alignment: cílový podíl tématu ve feedu 0,2–0,9 (výchozí 0,6); vyplň jen když řekne číslo nebo "hodně"/"trochu".',
    '- verify_persistence: true, když chce ověřit, že změna vydrží (to znamená 12 h pauzu); jinak null.',
    '- on_success: "maintain" když chce feed i potom udržovat, "stop" když má po splnění skončit; jinak null.',
    '- seeds_enabled: false jen když nechce Apify / startovní reels; jinak null.',
    `- limits: {max_cycles, max_active_minutes, max_days, max_cost_usd, hard_stop_at}. Vyplň jen to, co řekl, ostatní null. Výchozí hodnoty pro představu: rychlé ${f.max_cycles} cyklů / ${f.max_active_minutes} min / ${f.max_days} dny / ${f.max_cost_usd} USD, bezpečné ${s.max_cycles} / ${s.max_active_minutes} min / ${s.max_days} dní / ${s.max_cost_usd} USD. Jeden cyklus trvá zhruba 25–35 min aktivního tréninku plus pauza.`,
    '  hard_stop_at je absolutní čas ve formátu ISO 8601 s posunem pásma (např. "skonči do 18:00" → dnešní datum T18:00 s posunem; když 18:00 už dnes bylo, je to zítra).',
    '- active_hours: {from, to} ve formátu "HH:MM", jen když řekne, kdy smí agent běžet; jinak null.',
    '- assumptions: 0–5 short sentences IN ENGLISH about what you inferred or filled in yourself.',
    '- questions: 0–3 short questions IN ENGLISH about unclear things that affect the run (especially the account type if not stated).',
    '',
    'Pravidla: nevymýšlej limity ani časy, které uživatel neřekl. Neměň téma na jiné, než chce. Když popis není o tréninku feedu, dej do questions, co chybí, a target_topic vyplň podle nejlepšího odhadu.',
  ].join('\n');
}

/** První vyvážený JSON objekt v textu (modely občas přidají úvod, <think> nebo ```json). */
function extractJson(raw: string): unknown {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```(?:json)?/g, '');
  const start = text.indexOf('{');
  if (start === -1) throw new Error('The model did not return JSON.');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('The JSON from the model is incomplete.');
}

const uniq = (xs: string[]) => [...new Map(xs.map((x) => [x.toLowerCase(), x])).values()];

export async function compileGoal(text: string, opts: { apiKey: string | undefined; tz?: string }): Promise<CompileResult> {
  if (!opts.apiKey) throw new Error('FEATHERLESS_API_KEY is missing in .env; the description cannot be compiled without it.');
  const query = text.trim();
  if (query.length < 3) throw new Error('Describe what you want to see in your feed.');
  if (query.length > 2000) throw new Error('The description is too long (max. 2000 characters).');
  const tz = opts.tz ?? 'Europe/Prague';

  const llm = new ChatOpenAI({
    model: COMPILER_MODEL, apiKey: opts.apiKey, temperature: 0, maxTokens: 3000, timeout: 90_000, maxRetries: 1,
    configuration: { baseURL: FEATHERLESS_BASE_URL },
    // DeepSeek V4.x a Qwen3 mají ve výchozím stavu "thinking": přemýšlení spotřebovalo celý
    // limit tokenů a odpověď zůstala prázdná ("JSON od modelu je neúplný"). Konfigurace ho nepotřebuje.
    modelKwargs: { chat_template_kwargs: { thinking: false, enable_thinking: false } },
  });
  const t0 = Date.now();
  const messages = [new SystemMessage(systemPrompt(tz)), new HumanMessage(`Popis od uživatele:\n"""\n${query}\n"""`)];

  let draft: Draft | null = null;
  let lastErr = '';
  // Jeden opravný pokus: modelu se vrátí, co bylo s JSONem špatně.
  for (let attempt = 0; attempt < 2 && !draft; attempt++) {
    const res = await llm.invoke(attempt === 0 ? messages : [...messages, new HumanMessage(`Předchozí odpověď neprošla kontrolou: ${lastErr}. Vrať opravený JSON objekt, nic jiného.`)]);
    const raw = typeof res.content === 'string' ? res.content : res.content.map((c) => ('text' in c ? c.text : '')).join('');
    try {
      draft = DraftSchema.parse(extractJson(raw));
    } catch (err) {
      lastErr = err instanceof z.ZodError ? err.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (err as Error).message;
    }
  }
  if (!draft) throw new Error(`The model did not return a valid configuration (${lastErr}). Try rephrasing the description.`);
  return finalize(draft, Date.now() - t0, tz);
}

function finalize(d: Draft, ms: number, tz: string): CompileResult {
  const warnings: string[] = [];
  const questions = [...d.questions];

  // Neznámý typ účtu = skutečný (bezpečnější výchozí hodnota, vynutí i bezpečné tempo).
  let account = d.account_type ?? null;
  if (!account) {
    account = 'real';
    if (!questions.some((q) => /účet|account/i.test(q))) questions.unshift('Is this your real account or a test one? Assuming real for now (safe pace).');
  }
  if (account === 'real' && d.mode === 'fast') warnings.push('A real account always uses the safe pace, so fast was not used.');

  let hardStop: string | null = null;
  if (d.limits.hard_stop_at) {
    const t = Date.parse(d.limits.hard_stop_at);
    if (Number.isNaN(t)) warnings.push(`Could not read the stop time “${d.limits.hard_stop_at}”, leaving it out.`);
    else if (t <= Date.now()) warnings.push('The stop time is in the past, leaving it out.');
    else hardStop = new Date(t).toISOString();
  }

  const goal = normalizeGoal({
    goal_id: 'draft',
    target_topic: d.target_topic,
    target_description: d.target_description || d.target_topic,
    subtopics: uniq(d.subtopics.map((s) => s.replace(/^#/, ''))),
    old_topics: d.old_topics.map((o) => ({ topic: o.topic, description: o.description || o.topic })),
    languages: d.languages.length ? uniq(d.languages.map((l) => l.toLowerCase())) : undefined,
    account_type: account,
    mode: d.mode ?? undefined,
    target_alignment: d.target_alignment ?? undefined,
    verify_persistence: d.verify_persistence ?? false,
    on_success: d.on_success ?? 'stop',
    seeds_enabled: d.seeds_enabled ?? true,
    limits: { ...d.limits, hard_stop_at: hardStop } as GoalConfig['limits'],
    ...(d.active_hours ? { active_hours: { ...d.active_hours, timezone: tz } } : {}),
  });
  const { goal_id: _id, ...rest } = goal;

  const runMode = d.run_mode ?? 'dry';
  if (!d.run_mode) questions.push('Should the agent only watch, or run in full mode (likes, saves, searches)? Setting “Watch only” for now.');
  if (runMode === 'live' && account === 'real') warnings.push('Full mode on a real account: Instagram may restrict actions. The agent stops by itself on any warning.');
  if (goal.verify_persistence) warnings.push('Verifying that the change lasts means a pause of at least 12 h without training after success.');
  if (goal.subtopics.length < 3) warnings.push('Few subtopics to search; add a few specific queries.');

  return { goal: rest, run_mode: runMode, assumptions: d.assumptions, questions, warnings, model: COMPILER_MODEL, ms };
}
