import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

/**
 * Stav "seed": před scrollováním feedu stáhne přes Apify pár reels k tématu,
 * aby agent mohl začít tím, že je otevře, dokouká a olajkuje. To je silný
 * signál pro algoritmus hned na začátku, místo čekání, až téma přijde samo.
 *
 * Používá dva veřejné actory od Apify (vstupy ověřené z jejich input schema):
 *  - apify/instagram-hashtag-scraper: reels podle hashtagu nebo klíčového slova
 *  - apify/instagram-reel-scraper:    reels konkrétních autorů
 *
 * Dokumentace: docs/apify-seed.md
 */

export interface SeedReel {
  shortCode: string;
  /** URL, která otevře reel přímo v prohlížeči Reels (feed pak pokračuje odtud). */
  reelsUrl: string;
  owner: string;
  caption: string;
  hashtags: string[];
  durationSec: number;
  plays: number;
  timestamp: string;
  source: string;
}

export interface SeedOptions {
  token: string;
  /** Hashtagy bez # (např. ["supercars", "porsche"]). */
  hashtags?: string[];
  /** Slova k vyhledání (keywordSearch v hashtag scraperu). */
  keywords?: string[];
  /** Autoři, jejichž reels chceme (reel scraper). */
  usernames?: string[];
  /** Kolik výsledků stáhnout na hashtag/autora (platí se za výsledek). */
  perSource?: number;
  /** Kolik reels nakonec vrátit. */
  take?: number;
  /** Max. reels od jednoho autora, ať seed není jen jeden profil. */
  maxPerOwner?: number;
  /** Starší reels než tolik dní vyřadit. */
  maxAgeDays?: number;
  /** Cache výsledků, ať se za stejný dotaz neplatí dvakrát. */
  cacheDir?: string;
  cacheHours?: number;
}

const API = 'https://api.apify.com/v2';
const HASHTAG_ACTOR = 'apify~instagram-hashtag-scraper';
const REEL_ACTOR = 'apify~instagram-reel-scraper';

/** Text cíle → hashtagy: malá písmena, bez diakritiky a mezer ("Škoda Octavia" → "skodaoctavia"). */
export function toHashtag(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/^#/, '').replace(/[^a-z0-9_]/g, '');
}

/**
 * Spustí actor a počká na výsledek. Používá asynchronní běh + dotazování
 * (waitForFinish max 60 s na dotaz), protože synchronní endpoint končí po
 * 300 s chybou 408 a scrapování Instagramu může trvat déle.
 */
export async function runActor<T = unknown>(token: string, actor: string, input: unknown, maxWaitSec = 600): Promise<T[]> {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const startRes = await fetch(`${API}/acts/${actor}/runs?waitForFinish=60`, {
    method: 'POST',
    headers,
    body: JSON.stringify(input),
  });
  if (!startRes.ok) throw new Error(`Apify ${actor}: ${startRes.status} ${(await startRes.text()).slice(0, 300)}`);
  let run = ((await startRes.json()) as { data: ApifyRun }).data;

  const until = Date.now() + maxWaitSec * 1000;
  while (!TERMINAL.has(run.status)) {
    if (Date.now() > until) throw new Error(`Apify ${actor}: běh ${run.id} nedoběhl do ${maxWaitSec} s`);
    const res = await fetch(`${API}/actor-runs/${run.id}?waitForFinish=60`, { headers });
    if (!res.ok) throw new Error(`Apify run ${run.id}: ${res.status}`);
    run = ((await res.json()) as { data: ApifyRun }).data;
  }
  if (run.status !== 'SUCCEEDED') throw new Error(`Apify ${actor}: běh skončil se stavem ${run.status}`);

  const items = await fetch(`${API}/datasets/${run.defaultDatasetId}/items?clean=true&format=json`, { headers });
  if (!items.ok) throw new Error(`Apify dataset ${run.defaultDatasetId}: ${items.status}`);
  return (await items.json()) as T[];
}

interface ApifyRun { id: string; status: string; defaultDatasetId: string }
const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);

/** Položka z Instagram scraperů Apify (jen pole, která používáme; všechna volitelná). */
interface ApifyIgItem {
  shortCode?: string;
  url?: string;
  type?: string;
  productType?: string;
  caption?: string;
  hashtags?: string[];
  ownerUsername?: string;
  videoDuration?: number;
  videoPlayCount?: number;
  igPlayCount?: number;
  videoViewCount?: number;
  timestamp?: string;
  inputUrl?: string;
  error?: string;
}

function normalize(item: ApifyIgItem, source: string): SeedReel | null {
  const code = item.shortCode ?? item.url?.match(/\/(?:p|reels?)\/([\w-]+)/)?.[1];
  const isVideo = item.type === 'Video' || item.productType === 'clips';
  if (!code || !isVideo || item.error) return null;
  return {
    shortCode: code,
    reelsUrl: `https://www.instagram.com/reels/${code}/`,
    owner: item.ownerUsername ?? '',
    caption: (item.caption ?? '').slice(0, 500),
    hashtags: item.hashtags ?? [],
    durationSec: item.videoDuration ?? 0,
    plays: item.videoPlayCount ?? item.igPlayCount ?? item.videoViewCount ?? 0,
    timestamp: item.timestamp ?? '',
    source,
  };
}

/**
 * Vybere seed: jen videa 5–90 s, ne starší než maxAgeDays, nejvíc
 * přehrávaná, max. maxPerOwner od jednoho autora, bez duplicit.
 */
export function pickSeed(reels: SeedReel[], take: number, maxPerOwner: number, maxAgeDays: number): SeedReel[] {
  const minTs = Date.now() - maxAgeDays * 86_400_000;
  const seen = new Set<string>();
  const perOwner = new Map<string, number>();
  const out: SeedReel[] = [];
  const candidates = reels
    .filter((r) => r.durationSec === 0 || (r.durationSec >= 5 && r.durationSec <= 90))
    .filter((r) => !r.timestamp || Date.parse(r.timestamp) >= minTs)
    .sort((a, b) => b.plays - a.plays);
  for (const r of candidates) {
    if (seen.has(r.shortCode)) continue;
    const n = perOwner.get(r.owner) ?? 0;
    if (n >= maxPerOwner) continue;
    seen.add(r.shortCode);
    perOwner.set(r.owner, n + 1);
    out.push(r);
    if (out.length >= take) break;
  }
  // Zamíchat, ať agent nejde vždycky od nejpopulárnějšího.
  return out.sort(() => Math.random() - 0.5);
}

export async function fetchSeedReels(opts: SeedOptions): Promise<SeedReel[]> {
  const {
    token, hashtags = [], keywords = [], usernames = [],
    perSource = 15, take = 8, maxPerOwner = 2, maxAgeDays = 180,
    cacheDir = 'logs/seed-cache', cacheHours = 24,
  } = opts;

  const key = toHashtag([...hashtags, ...keywords, ...usernames].join('_')).slice(0, 80) || 'empty';
  const cacheFile = `${cacheDir}/${key}.json`;
  if (existsSync(cacheFile)) {
    const cached = JSON.parse(readFileSync(cacheFile, 'utf8')) as { at: number; reels: SeedReel[] };
    if (Date.now() - cached.at < cacheHours * 3_600_000) return pickSeed(cached.reels, take, maxPerOwner, maxAgeDays);
  }

  const jobs: Promise<SeedReel[]>[] = [];
  const tags = hashtags.map(toHashtag).filter(Boolean);
  if (tags.length) {
    jobs.push(
      runActor<ApifyIgItem>(token, HASHTAG_ACTOR, { hashtags: tags, resultsType: 'reels', resultsLimit: perSource })
        .then((items) => items.map((i) => normalize(i, `#${i.inputUrl ?? tags.join(',')}`)).filter((r): r is SeedReel => !!r)),
    );
  }
  if (keywords.length) {
    // Každé slovo zvlášť: víc slov v jednom dotazu výsledky zužuje.
    jobs.push(
      runActor<ApifyIgItem>(token, HASHTAG_ACTOR, { hashtags: keywords, keywordSearch: true, resultsType: 'reels', resultsLimit: perSource })
        .then((items) => items.map((i) => normalize(i, `keyword`)).filter((r): r is SeedReel => !!r)),
    );
  }
  if (usernames.length) {
    jobs.push(
      runActor<ApifyIgItem>(token, REEL_ACTOR, { username: usernames, resultsLimit: perSource, skipPinnedPosts: true })
        .then((items) => items.map((i) => normalize(i, `@${i.ownerUsername ?? ''}`)).filter((r): r is SeedReel => !!r)),
    );
  }
  if (!jobs.length) throw new Error('Seed potřebuje aspoň jeden hashtag, klíčové slovo nebo autora.');

  const results = await Promise.allSettled(jobs);
  const reels = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (!reels.length && errors.length) throw errors[0].reason;
  for (const e of errors) console.warn(`  ! část seedu selhala: ${(e.reason as Error).message}`);

  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), reels }, null, 2));
  return pickSeed(reels, take, maxPerOwner, maxAgeDays);
}
