import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, type MessageContent } from '@langchain/core/messages';
import type { GoalConfig } from './goal.ts';

/**
 * Judge (WORKFLOW.md, sekce 7): klasifikuje obsah vůči cíli a starým tématům.
 * Bez klíče k Featherless používá klíčová slova (verze "judge-kw"), ta se
 * s LLM verzí neporovnávají (sekce 13.2: měření jen při stejné judge_version).
 */
export interface JudgeInfo {
  author: string;
  caption: string;
  hashtags?: string[];
  audio?: string;
}

export interface JudgeResult {
  target_score: number;
  old_topic_score: number;
  subtopic: string;
  reason: string;
  /** Odkud výsledek je (text, text + obrázek, klíčová slova, timeout). */
  via: 'text' | 'prefetch' | 'vision' | 'keyword' | 'timeout' | 'error';
  /**
   * Je skóre podložené? true = popisek/hashtagy/obrázek téma výslovně dokládají
   * (nebo shoda klíčových slov). false = model jen odhaduje. Odměny (like,
   * uložení, follow) se dávají jen při důkazu.
   */
  evidence: boolean;
  ms: number;
  cost_usd: number;
  error?: string;
}

export type Category = 'TARGET_STRONG' | 'OLD_TOPIC' | 'TARGET_WEAK' | 'NEUTRAL';

/** Rozhodovací tabulka ze sekce 7, shora dolů, platí první shoda. */
export function categorize(j: Pick<JudgeResult, 'target_score' | 'old_topic_score'>): Category {
  // Protichůdné skóre (cíl i staré téma vysoko) = model neví → bez odměny. Odchylka od tabulky v sekci 7.
  if (j.target_score >= 0.5 && j.old_topic_score >= 0.6) return 'NEUTRAL';
  if (j.target_score >= 0.8) return 'TARGET_STRONG';
  if (j.old_topic_score >= 0.6) return 'OLD_TOPIC';
  if (j.target_score >= 0.5) return 'TARGET_WEAK';
  return 'NEUTRAL';
}

/** Výsledek je nejistý → vzít screenshot a zeptat se znovu (sekce 7). */
export const uncertain = (j: Pick<JudgeResult, 'target_score' | 'old_topic_score'>) =>
  j.target_score > 0.2 && j.target_score < 0.8 && j.old_topic_score < 0.6;

/** Featherless je kompatibilní s OpenAI, takže jde přes ChatOpenAI z LangChain. */
export const FEATHERLESS_BASE_URL = 'https://api.featherless.ai/v1';

/** Ceny v USD za 1M tokenů (z Featherless /v1/models, ověřeno 2026-11-13). */
const PRICES: Record<string, { input: number; output: number }> = {
  'Qwen/Qwen3-VL-30B-A3B-Instruct': { input: 0.15, output: 0.5 },
  'Qwen/Qwen3-VL-8B-Instruct': { input: 0.18175, output: 1.35125 },
  'Qwen/Qwen3-8B': { input: 0.117, output: 0.455 },
  'Qwen/Qwen2.5-7B-Instruct': { input: 0.17, output: 0.2 },
  'deepseek-ai/DeepSeek-V4.1-Flash-1017': { input: 0.225, output: 0.9 },
};

export interface JudgeOptions {
  apiKey?: string;
  textModel: string;
  visionModel: string;
}

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => strip(s).split(/[^a-z0-9]+/).filter((w) => w.length > 3);

export class Judge {
  readonly version: string;
  private readonly opts: JudgeOptions;
  private readonly goal: GoalConfig;
  constructor(goal: GoalConfig, opts: JudgeOptions) {
    this.goal = goal;
    this.opts = opts;
    // v2: krátký výstup bez zdůvodnění. Změna verze = M0 se před porovnáním přehodnotí (sekce 13.2).
    // v3: pole e (důkaz), obrázek u každého reelu ve feedu, protichůdné skóre = NEUTRAL.
    this.version = opts.apiKey ? `judge-v3:${opts.textModel}|${opts.visionModel}` : 'judge-kw-v1';
  }

  /** Klasifikace jen z textu, nebo s obrázkem (vždy u měření M). */
  async judge(info: JudgeInfo, screenshot?: Buffer | null): Promise<JudgeResult> {
    const t0 = Date.now();
    if (!this.opts.apiKey) return { ...this.keyword(info), ms: 0 };
    // Bez popisku, autora, hashtagů i obrázku není co hodnotit: model by hádal 0,5,
    // což se počítá jako zásah k tématu. Bez informace = 0.
    if (!screenshot && !info.caption.trim() && !info.author && !(info.hashtags ?? []).length) {
      return { target_score: 0, old_topic_score: 0, subtopic: '', reason: 'bez informací', via: 'keyword', ms: 0, cost_usd: 0, evidence: false };
    }
    const model = screenshot ? this.opts.visionModel : this.opts.textModel;
    try {
      const content: MessageContent = screenshot
        ? [
            { type: 'text', text: this.prompt(info, true) },
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot.toString('base64')}` } },
          ]
        : this.prompt(info, false);
      const llm = new ChatOpenAI({
        model, apiKey: this.opts.apiKey, temperature: 0, maxTokens: 60, timeout: 15_000, maxRetries: 1,
        configuration: { baseURL: FEATHERLESS_BASE_URL },
        // Qwen3 (ne VL) má ve výchozím stavu "thinking", což odpověď zpomalí o stovky tokenů.
        ...(/Qwen3-(?!VL)/.test(model) ? { modelKwargs: { chat_template_kwargs: { enable_thinking: false } } } : {}),
      });
      const res = await llm.invoke([new HumanMessage({ content })]);
      const text = typeof res.content === 'string' ? res.content : res.content.map((c) => ('text' in c && typeof c.text === 'string' ? c.text : '')).join('');
      const usage = res.usage_metadata;
      const price = PRICES[model];
      const cost = usage && price ? (usage.input_tokens * price.input + usage.output_tokens * price.output) / 1e6 : 0;
      return { ...parse(text), via: screenshot ? 'vision' : 'text', ms: Date.now() - t0, cost_usd: cost };
    } catch (err) {
      // Chyba nebo timeout Judge → NEUTRAL (sekce 11).
      return { target_score: 0, old_topic_score: 0, subtopic: '', reason: 'chyba Judge', via: 'error', ms: Date.now() - t0, cost_usd: 0, error: (err as Error).message.slice(0, 200), evidence: false };
    }
  }

  /**
   * Postup ze sekce 7: nejdřív text; když je nejistý, v čase 1,5 s screenshot
   * a znovu s obrázkem. Když nic nepřijde do 4 s od začátku reelu → NEUTRAL.
   * Reel se mezitím dál sleduje (volající nečeká, jen spustí tuhle promise).
   */
  /** Náklady volání, jejichž výsledek se nepoužil (paralelní text/obrázek, hodnocení dopředu). */
  private unclaimedUsd = 0;
  drainUnclaimedCost(): number { const x = this.unclaimedUsd; this.unclaimedUsd = 0; return x; }

  /** Textová hodnocení spuštěná dopředu (klíč: autor + popisek). */
  private readonly ahead = new Map<string, Promise<JudgeResult>>();
  private static key(info: JudgeInfo) { return `${info.author}|${info.caption.slice(0, 200)}`; }

  /**
   * Spustí textové hodnocení reelu, který teprve přijde (je pod aktuálním v DOM).
   * Když se pak reel objeví, judgeReel výsledek jen vyzvedne a NEUTRAL jde
   * přeskočit hned za 1–2 s, místo čekání na model (2–4 s, občas 20 s).
   */
  prefetch(info: JudgeInfo): void {
    if (!this.opts.apiKey || !info.caption.trim() && !info.author) return;
    const k = Judge.key(info);
    if (this.ahead.has(k)) return;
    this.ahead.set(k, this.judge(info));
    // Cache držet malou: Instagram drží v DOM jen pár reels dopředu.
    if (this.ahead.size > 12) this.ahead.delete(this.ahead.keys().next().value!);
  }

  /**
   * Jasná shoda bez modelu: celé slovo nebo hashtag z cílového tématu a podtémat
   * (např. #porsche, „rallye“). Jen pozitivní rozhodnutí; zbytek jde na model.
   * Používá se při reakci na reel, ne při měření M (tam je vždy model se screenshotem).
   */
  quickMatch(info: JudgeInfo): JudgeResult | null {
    const terms = [this.goal.target_topic, ...this.goal.subtopics].map(strip).filter((k) => k.length >= 3);
    const text = ` ${strip(`${info.caption} ${(info.hashtags ?? []).map((h) => `#${h}`).join(' ')}`).replace(/[^a-z0-9#]+/g, ' ')} `;
    const old = this.goal.old_topics.flatMap((o) => [strip(o.topic), ...words(o.description)]);
    if (old.some((w) => w.length > 3 && text.includes(` ${w} `))) return null;
    const hit = terms.find((k) => {
      const w = k.replace(/[^a-z0-9]+/g, ' ').trim();
      return text.includes(` ${w} `) || text.includes(` #${w.replace(/ /g, '')} `);
    });
    if (!hit) return null;
    return { target_score: 0.85, old_topic_score: 0, subtopic: hit, reason: `klíčové slovo „${hit}“`, via: 'keyword', ms: 0, cost_usd: 0, evidence: true };
  }

  /**
   * Hodnocení reelu, na který se agent právě dívá (sekce 7, upraveno):
   *  1. jasná shoda klíčových slov → hned TARGET_STRONG,
   *  2. souběžně text (hotový dopředu / z dlaždice / nový) a obrázek (snímek v ~1,2 s),
   *  3. platí první výsledek, který je podložený (evidence) a jistý; text bez důkazu
   *     se bere jen tehdy, když obrázek nedorazí, a i pak bez odměn,
   *  4. když do 4 s od začátku reelu nic nedorazí → NEUTRAL.
   * Popisky na Reels s obsahem videa často nesouvisí, takže bez obrázku model hádá.
   */
  async judgeReel(info: JudgeInfo, startedAt: number, screenshot: () => Promise<Buffer | null>, hint?: Promise<JudgeResult>): Promise<JudgeResult> {
    const quick = this.opts.apiKey ? this.quickMatch(info) : null;
    if (quick) return { ...quick, ms: Date.now() - startedAt };
    const deadline = startedAt + 4000;
    const timeoutResult: JudgeResult = { target_score: 0, old_topic_score: 0, subtopic: '', reason: 'Judge nestihl 4 s', via: 'timeout', ms: 4000, cost_usd: 0, evidence: false };
    if (!this.opts.apiKey) return this.judge(info);

    const k = Judge.key(info);
    const cached = this.ahead.get(k);
    this.ahead.delete(k);
    const hasText = !!info.caption.trim() || !!(info.hashtags ?? []).length;
    const text: Promise<JudgeResult> | null = cached ?? hint ?? (hasText ? this.judge(info) : null);
    const vision: Promise<JudgeResult> = (async () => {
      const wait = startedAt + 1200 - Date.now(); // pár snímků videa, ať není snímek černý
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const shot = await screenshot();
      return shot ? this.judge(info, shot) : { ...timeoutResult, reason: 'bez snímku', via: 'error' as const };
    })();

    const settled = (r: JudgeResult) => r.via !== 'error' && r.evidence && !uncertain(r);
    let chosen: JudgeResult | null = null;
    const result = await new Promise<JudgeResult>((resolve) => {
      let textResult: JudgeResult | null = null;
      let done = false;
      const finish = (r: JudgeResult) => { if (!done) { done = true; chosen = r; resolve({ ...r, ms: Date.now() - startedAt }); } };
      const timer = setTimeout(() => finish(textResult ? { ...textResult, evidence: false } : timeoutResult), Math.max(0, deadline - Date.now()));
      text?.then((r) => {
        if (cached && r.via === 'text') r.via = 'prefetch';
        textResult = r;
        if (settled(r)) { clearTimeout(timer); finish(r); }
      });
      vision.then((r) => {
        if (r.via === 'error') return; // počká se na text nebo na timeout
        clearTimeout(timer);
        // Obrázek je hlavní zdroj; když text má důkaz a obrázek ne, platí text.
        finish(!r.evidence && textResult && settled(textResult) ? textResult : r);
      });
    });
    // Náklady volání, které nebylo použité (nebo doběhlo později), se přičtou zvlášť.
    for (const p of [text, vision]) {
      void p?.then((r) => { if (r.cost_usd && r !== chosen) this.unclaimedUsd += r.cost_usd; });
    }
    return result;
  }


  private keyword(info: JudgeInfo): Omit<JudgeResult, 'ms'> {
    const text = strip(`${info.author} ${info.caption} ${(info.hashtags ?? []).join(' ')} ${info.audio ?? ''}`);
    const target = [this.goal.target_topic, ...this.goal.subtopics].map(strip).filter((k) => k.length > 2);
    const hitTarget = target.find((k) => text.includes(k) || text.includes(k.replace(/\s+/g, '')));
    const oldWords = this.goal.old_topics.flatMap((o) => [strip(o.topic), ...words(o.description)]);
    const hitOld = oldWords.find((k) => k.length > 3 && text.includes(k));
    return {
      target_score: hitTarget ? 0.85 : 0.05,
      old_topic_score: hitOld ? 0.7 : 0,
      subtopic: hitTarget ?? '',
      reason: hitTarget ? `klíčové slovo „${hitTarget}“` : hitOld ? `staré téma „${hitOld}“` : 'bez shody',
      via: 'keyword',
      cost_usd: 0,
      evidence: !!(hitTarget || hitOld),
    };
  }

  private prompt(info: JudgeInfo, withImage: boolean): string {
    const g = this.goal;
    return [
      `Hodnotíš obsah z Instagramu pro uživatele, který chce ve feedu víc tématu: "${g.target_topic}" (${g.target_description}).`,
      `Podtémata: ${g.subtopics.join(', ')}.`,
      g.old_topics.length ? `Stará témata, která chce potlačit: ${g.old_topics.map((o) => `${o.topic} (${o.description})`).join('; ')}.` : 'Stará témata: žádná.',
      ``,
      `Autor: ${info.author || '(neznámý)'}`,
      `Popisek: ${info.caption.slice(0, 600) || '(žádný)'}`,
      `Hashtagy: ${(info.hashtags ?? []).join(' ') || '(žádné)'}`,
      `Hudba: ${info.audio || '(neznámá)'}`,
      withImage ? `Přikládám snímek obsahu.` : '',
      ``,
      // Krátký výstup bez zdůvodnění: u krátkého promptu tvoří většinu latence generování.
      `Popisky na Instagramu často s obsahem videa nesouvisí. Hodnoť jen podle toho, co je opravdu vidět${withImage ? ' na snímku' : ''} nebo výslovně napsáno.`,
      `Když nic téma nedokládá, dej t=0, o=0 a e=0. Nehádej.`,
      `Odpověz pouze JSONem bez dalšího textu, bez zdůvodnění:`,
      `{"t": <0–1, jak moc obsah odpovídá cílovému tématu>, "o": <0–1, maximum přes stará témata>, "s": "<nejbližší podtéma nebo prázdné>", "e": <1 pokud ${withImage ? 'snímek nebo text' : 'text'} téma výslovně dokládá, jinak 0>}`,
    ].join('\n');
  }
}

function parse(raw: string): Pick<JudgeResult, 'target_score' | 'old_topic_score' | 'subtopic' | 'reason' | 'evidence'> {
  const json = raw.replace(/<think>[\s\S]*?<\/think>/g, '').match(/\{[\s\S]*\}/)?.[0];
  if (!json) throw new Error(`Judge nevrátil JSON: ${raw.slice(0, 200)}`);
  const v = JSON.parse(json) as Record<string, unknown>;
  const num = (x: unknown) => {
    const n = Number(x);
    if (!Number.isFinite(n)) throw new Error(`neplatné skóre v ${json.slice(0, 200)}`);
    return Math.min(1, Math.max(0, n));
  };
  // Krátké klíče (t, o, s) i dlouhé (target_score, …) kvůli zpětné kompatibilitě.
  const t = v.t ?? v.target_score;
  const o = v.o ?? v.old_topic_score;
  const e = v.e ?? v.evidence;
  return {
    target_score: num(t),
    old_topic_score: o === undefined ? 0 : num(o),
    subtopic: String(v.s ?? v.subtopic ?? '').slice(0, 60),
    reason: String(v.reason ?? '').slice(0, 200),
    evidence: e === 1 || e === true || e === '1',
  };
}
