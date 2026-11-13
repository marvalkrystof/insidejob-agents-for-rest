import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fetchSeedReels, toHashtag, type SeedReel } from '../seed.ts';
import type { GoalConfig } from './goal.ts';
import type { Judge } from './judge.ts';

/**
 * Discovery (WORKFLOW.md, sekce 2 a 14): fronta startovních reels a tvůrců.
 * Plní se přes Apify (hashtag scraper) a každý kandidát se ověří přes Judge.
 *
 * Omezení proti sekci 14.4: Judge vidí popisek a hashtagy, ne celé video
 * s přepisem zvuku. "Čistotu" autora a zájem vůči jeho ostatním reels zatím
 * neověřujeme. Tvůrci ve frontě jsou autoři ověřených startovních reels.
 */
export interface SeedItem {
  url: string;
  reel_id: string;
  author: string;
  subtopic: string;
  target_score: number;
  old_topic_score: number;
  timestamp: string;
}

interface DiscoveryFile {
  goal_id: string;
  seeds: SeedItem[];
  creators: string[];
  used_creators: string[];
  subtopics_used_for_fetch: string[];
  refilled_at: string | null;
}

/** Odhad ceny Apify: zhruba $2,60 za 1 000 výsledků (free plán, stránka actoru). */
const APIFY_USD_PER_RESULT = 2.6 / 1000;
const MIN_QUEUE = 15;

export class Discovery {
  private data: DiscoveryFile;
  private readonly file: string;
  private readonly goal: GoalConfig;
  private readonly judge: Judge;
  private readonly apifyToken: string | undefined;
  constructor(goal: GoalConfig, judge: Judge, apifyToken: string | undefined, dir = 'data') {
    this.goal = goal;
    this.judge = judge;
    this.apifyToken = apifyToken;
    this.file = `${dir}/discovery-${goal.goal_id}.json`;
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, 'utf8')) as DiscoveryFile)
      : { goal_id: goal.goal_id, seeds: [], creators: [], used_creators: [], subtopics_used_for_fetch: [], refilled_at: null };
  }

  get available(): boolean { return !!this.apifyToken; }

  private save() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /**
   * Doplní frontu na aspoň 15 nepoužitých startovních reels. Vrací cenu
   * (Apify + Judge) a počet přidaných.
   */
  async refill(usedSeeds: string[], subtopics: string[], log: (msg: string) => void): Promise<{ added: number; cost_usd: number }> {
    const unused = this.data.seeds.filter((s) => !usedSeeds.includes(s.reel_id));
    if (!this.apifyToken || unused.length >= MIN_QUEUE) return { added: 0, cost_usd: 0 };

    const hashtags = subtopics.map(toHashtag).filter(Boolean).slice(0, 4);
    log(`Apify: doplňuju frontu (${unused.length} < ${MIN_QUEUE}) z #${hashtags.join(' #')}`);
    const raw: SeedReel[] = await fetchSeedReels({
      token: this.apifyToken, hashtags, perSource: 15, take: 60, maxPerOwner: 3, maxAgeDays: 30, cacheHours: 12,
    });
    let cost = raw.length * APIFY_USD_PER_RESULT;

    let added = 0;
    const known = new Set(this.data.seeds.map((s) => s.reel_id));
    const fresh = raw.filter((r) => !known.has(r.shortCode) && !usedSeeds.includes(r.shortCode));
    // Hodnotit po 3 najednou (sekvenčně to u 60 kandidátů trvalo ~3 min).
    const verdicts = await mapLimit(fresh, 3, (r) => this.judge.judge({ author: r.owner, caption: r.caption, hashtags: r.hashtags }));
    for (const [i, r] of fresh.entries()) {
      const j = verdicts[i];
      cost += j.cost_usd;
      // Požadavek 14.4: target ≥ 0,85 a staré téma < 0,2.
      if (j.target_score < 0.85 || j.old_topic_score >= 0.2 || !j.evidence) continue;
      this.data.seeds.push({
        url: r.reelsUrl, reel_id: r.shortCode, author: r.owner, subtopic: j.subtopic || hashtags[0] || '',
        target_score: j.target_score, old_topic_score: j.old_topic_score, timestamp: r.timestamp,
      });
      if (r.owner && !this.data.creators.includes(r.owner)) this.data.creators.push(r.owner);
      added++;
    }
    this.data.seeds = interleave(this.data.seeds);
    this.data.subtopics_used_for_fetch.push(...hashtags);
    this.data.refilled_at = new Date().toISOString();
    this.save();
    return { added, cost_usd: cost };
  }

  /** Další startovní reel, který ještě nebyl použit a jehož autor dnes ještě nebyl (14.3). */
  nextSeed(usedSeeds: string[], authorsToday: string[]): SeedItem | null {
    return this.data.seeds.find((s) => !usedSeeds.includes(s.reel_id) && !authorsToday.includes(s.author)) ?? null;
  }

  nextCreator(followed: string[]): string | null {
    const c = this.data.creators.find((x) => !this.data.used_creators.includes(x) && !followed.includes(x)) ?? null;
    if (c) { this.data.used_creators.push(c); this.save(); }
    return c;
  }
}

/** Jako Promise.all, ale nejvýš `limit` úloh najednou (limit souběhu u Featherless). */
async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Pestrost fronty (14.4): střídat podtémata, víc než 2 od stejného autora za sebou ne. */
function interleave(seeds: SeedItem[]): SeedItem[] {
  const bySub = new Map<string, SeedItem[]>();
  for (const s of seeds) bySub.set(s.subtopic, [...(bySub.get(s.subtopic) ?? []), s]);
  const out: SeedItem[] = [];
  const queues = [...bySub.values()];
  while (queues.some((q) => q.length)) {
    for (const q of queues) {
      const idx = q.findIndex((s) => !(out.length >= 2 && out[out.length - 1].author === s.author && out[out.length - 2].author === s.author));
      if (idx >= 0) out.push(...q.splice(idx, 1));
      else if (q.length) out.push(q.shift()!);
    }
  }
  return out;
}
