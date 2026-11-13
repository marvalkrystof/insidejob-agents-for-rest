import { mkdirSync, writeFileSync } from 'node:fs';
import { chance, pause, rand, sleep } from '../human.ts';
import * as ig from '../instagram.ts';
import * as act from './actions.ts';
import { StopSignal, type Ctx } from './context.ts';
import { MODE_PARAMS, rewardP, type BudgetAction } from './goal.ts';
import { selectorMissing, safety } from './guards.ts';
import { categorize, type Category, type JudgeResult } from './judge.ts';

/**
 * Reakce na jeden reel podle rozhodovací tabulky (WORKFLOW.md, sekce 7).
 * Platí pro všechny zdroje (feed, search, profile, explore, seed, seed_chain);
 * do feed_alignment se počítá jen `feed`.
 */
export type Source = 'feed' | 'search' | 'profile' | 'explore' | 'seed' | 'seed_chain';

export interface ReelOutcome {
  reel_id: string;
  author: string;
  category: Category;
  target_score: number;
  old_topic_score: number;
  subtopic: string;
  actions: string[];
  watch_s: number;
}

export const hashtagsOf = (caption: string) => [...caption.matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1].toLowerCase());

/** Smí se akce provést? (dry run, rozpočet, schopnost webu) */
function allowed(c: Ctx, action: BudgetAction): boolean {
  if (c.cfg.dryRun) return false;
  if (c.rt.missingCapabilities.has(action)) return false;
  return c.store.canSpend(action, c.goal, newAccount(c));
}
/** Nový účet = první 3 dny od začátku prvního cíle (poloviční follow/unfollow). */
const newAccount = (c: Ctx) => {
  const first = Object.values(c.store.state.goals).map((g) => Date.parse(g.started_at)).sort()[0];
  return first ? Date.now() - first < 3 * 86_400_000 : true;
};

function missing(c: Ctx, capability: string, why: string) {
  if (c.rt.missingCapabilities.has(capability)) return;
  c.rt.missingCapabilities.add(capability);
  c.events.write('capability_missing', { capability, why });
  c.log.warn('react', `${capability}: ${why} (v této session už nezkouším)`);
}

/** Mezi dvěma akcemi na stejném reelu 0,6–2,5 s (sekce 9). */
const between = () => sleep(rand(600, 2500));

/** Délka "dokoukat celé": délka + 0–1 s, u reelů nad 90 s jen 60–90 s. */
const fullWatch = (duration: number) => (duration > 90 ? rand(60, 90) : (duration || 15) + rand(0, 1));

export async function react(
  c: Ctx,
  phase: string,
  source: Source,
  opts: { seed?: { reel_id: string; target_score: number; subtopic: string }; seedId?: string; hint?: Promise<JudgeResult> } = {},
): Promise<ReelOutcome | null> {
  await safety(c);
  const page = c.page;
  let reel = await ig.readActiveReel(page);
  for (let i = 0; !reel && i < 4; i++) { await pause(600); reel = await ig.readActiveReel(page); }
  if (!reel) {
    // Fotka nebo karusel (výsledky hledání, profil, Explore): není co sledovat, přeskočit.
    const photo = await page.locator('[role="dialog"] img, article img, main img').count().catch(() => 0);
    if (photo > 0 && source !== 'feed') {
      c.log.info(phase, `${source.padEnd(10)} fotka (ne video), přeskakuju`);
      c.events.write('reel', { cycle: c.store.goal().cycle, phase, source, category: 'SKIPPED_PHOTO', actions: ['skip_photo'], watch_s: 0 });
      await sleep(rand(800, 1800));
      return null;
    }
    selectorMissing(c, 'video reelu');
    return null;
  }

  const t0 = Date.now();
  const hashtags = hashtagsOf(reel.meta.caption);
  const info = { author: reel.meta.author, caption: reel.meta.caption, hashtags, audio: reel.meta.audio };

  // Startovní reel je předem ověřený: Judge se nevolá, bere se jako TARGET_STRONG (pozn. 5).
  let j: Pick<JudgeResult, 'target_score' | 'old_topic_score' | 'subtopic' | 'via' | 'cost_usd' | 'evidence'>;
  if (source === 'seed' && opts.seed) {
    j = { target_score: opts.seed.target_score, old_topic_score: 0, subtopic: opts.seed.subtopic, via: 'text', cost_usd: 0, evidence: true };
  } else {
    const verdict = c.judge.judgeReel(info, t0, () => ig.screenshotActive(page), opts.hint);
    // Mezitím dopředu ohodnotit popisky dalších 2 reels (jsou už v DOM).
    void prefetchUpcoming(c);
    j = await verdict;
    c.store.addCost(c.judge.drainUnclaimedCost());
    c.store.addCost(j.cost_usd);
  }
  let category: Category = source === 'seed' ? 'TARGET_STRONG' : categorize(j);
  // Odměna jen za podložené skóre: bez důkazu (model jen odhadl) se reel jen dokouká.
  if (category === 'TARGET_STRONG' && !j.evidence) category = 'TARGET_WEAK';
  const actions: string[] = [];
  const elapsed = () => (Date.now() - t0) / 1000;
  // Dokoukání se počítá z přehraného času (buffering se nezapočítá), se stropem +5 s skutečného času.
  const watchUntil = async (sec: number) => { const left = sec - elapsed(); if (left > 0) await ig.watch(page, left, left + 5); };
  // Přeskočení (1–2 s, 0,5–1 s) je skutečný čas, ať reel nevisí, když se video nerozjede.
  const skipAt = async (sec: number) => { const left = sec - elapsed(); if (left > 0) await sleep(left * 1000); };

  if (category === 'TARGET_STRONG') {
    const total = fullWatch(reel.duration);
    // Like a uložení s pravděpodobností podle jistoty (goal.reward), v rámci rozpočtů.
    const doLike = chance(rewardP(c.goal.reward.like_p, j.target_score)) && allowed(c, 'like');
    if (doLike) {
      // Like až ve druhé polovině sledování (pozn. 3).
      await watchUntil(total * rand(0.5, 0.85));
      if (!(await guardSame(c, reel, 'like'))) { /* reel se mezitím změnil */ }
      else if (await ig.like(page)) {
        await sleep(1500);
        if (await ig.hasLabel(page, ig.LABELS.unlike)) {
          c.store.spend('like'); actions.push('like'); c.rt.failedActionsInRow = 0;
          await auditShot(c, 'like', reel);
        }
        else await failedAction(c, 'like');
      } else selectorMissing(c, 'tlačítko Like');
    }
    await watchUntil(total);
    actions.unshift('watch_full');
    if (chance(0.3)) { const again = fullWatch(reel.duration); await ig.watch(page, again, again + 5); actions.push('rewatch'); }

    if (chance(rewardP(c.goal.reward.save_p, j.target_score)) && allowed(c, 'save')) {
      await between();
      if (await guardSame(c, reel, 'save')) {
        if (await ig.save(page)) { c.store.spend('save'); actions.push('save'); await auditShot(c, 'save', reel); }
        else if (!(await ig.hasLabel(page, ig.LABELS.unsave))) missing(c, 'save', 'tlačítko Uložit u tohoto typu obsahu není');
      }
    }
    if (chance(0.1)) {
      await between();
      if ((await guardSame(c, reel, 'open_audio')) && (await act.openAudio(page))) { actions.push('open_audio'); await act.back(page); }
    }
    if (c.goal.dm_share_recipient && chance(0.05) && allowed(c, 'share')) {
      missing(c, 'share', 'sdílení do DM zatím není implementované');
    }
    await followRule(c, reel.meta.author, source, actions);
  } else if (category === 'OLD_TOPIC') {
    await skipAt(rand(0.5, 1.0));
    actions.push('skip');
    if (chance(MODE_PARAMS[c.goal.mode].notInterestedP) && allowed(c, 'not_interested')) {
      if (await ig.notInterested(page)) { c.store.spend('not_interested'); actions.push('not_interested'); }
      else missing(c, 'not_interested', 'menu „…“ na webových Reels nemá „Nemám zájem“');
    }
  } else if (category === 'TARGET_WEAK') {
    await watchUntil(fullWatch(reel.duration));
    actions.push('watch_full');
  } else {
    await skipAt(rand(1, 2));
    actions.push('skip');
  }

  const out: ReelOutcome = {
    reel_id: reel.id, author: reel.meta.author, category,
    target_score: round(j.target_score), old_topic_score: round(j.old_topic_score), subtopic: j.subtopic,
    actions, watch_s: Math.round(elapsed() * 10) / 10,
  };
  if (category === 'TARGET_STRONG' && out.subtopic) c.rt.subtopicHits[out.subtopic] = (c.rt.subtopicHits[out.subtopic] ?? 0) + 1;
  c.rt.cycleReels.push({ source, target_score: out.target_score, old_topic_score: out.old_topic_score, subtopic: out.subtopic, hashtags });
  c.events.write('reel', {
    cycle: c.store.goal().cycle, phase, reel_id: out.reel_id, author: out.author, source,
    caption: reel.meta.caption.replace(/\s+/g, ' ').slice(0, 120),
    ...(opts.seedId ? { seed_id: opts.seedId } : {}),
    target_score: out.target_score, old_topic_score: out.old_topic_score, subtopic: out.subtopic,
    category, actions, watch_s: out.watch_s, judge: j.via, evidence: j.evidence,
  });
  c.log.info(phase, `${source.padEnd(10)} ${category.padEnd(13)} t=${out.target_score.toFixed(2)} o=${out.old_topic_score.toFixed(2)} @${out.author || '?'} ${out.watch_s} s${actions.length ? ` [${actions.join(', ')}]` : ''}`);
  c.store.touch();
  c.store.save();
  return out;
}

async function prefetchUpcoming(c: Ctx) {
  for (const offset of [1, 2]) {
    const next = await ig.readActiveReel(c.page, offset).catch(() => null);
    if (next) c.judge.prefetch({ author: next.meta.author, caption: next.meta.caption, hashtags: hashtagsOf(next.meta.caption), audio: next.meta.audio });
  }
}

/**
 * Před akcí ověřit, že je na obrazovce pořád stejný reel. Feed se mohl mezitím
 * posunout (automatický posun Instagramu, opožděné švihnutí) a klik by dopadl
 * na jiný reel.
 */
async function guardSame(c: Ctx, reel: ig.ActiveReel, action: string): Promise<boolean> {
  if (await ig.stillOn(c.page, reel)) return true;
  c.log.warn('react', `${action} vynechán: reel @${reel.meta.author || '?'} už není na obrazovce`);
  c.events.write('action_skipped', { action, reason: 'reel_changed', reel_id: reel.id, author: reel.meta.author });
  return false;
}

/** Snímek reelu při like/uložení (logs/<akce>/), ať jde zpětně ověřit, co dostalo odměnu. */
async function auditShot(c: Ctx, action: string, reel: ig.ActiveReel) {
  const shot = await ig.screenshotActive(c.page);
  if (!shot) return;
  const dir = `logs/${action}s`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/${new Date().toISOString().replace(/[:.]/g, '-')}-${(reel.meta.author || 'unknown').replace(/[^\w.-]/g, '_')}.jpg`, shot);
}

/** Pravidlo sledování (pozn. 2): autor 2× TARGET_STRONG → profil → follow → zpět. Ne z profilu (žádná rekurze). */
async function followRule(c: Ctx, author: string, source: Source, actions: string[]) {
  if (!author) return;
  const gs = c.store.goal();
  gs.creator_strong_count[author] = (gs.creator_strong_count[author] ?? 0) + 1;
  if (source === 'profile' || gs.creator_strong_count[author] < 2 || gs.followed_by_agent.includes(author) || !allowed(c, 'follow')) return;
  await between();
  if (!(await act.openProfile(c.page, author))) { selectorMissing(c, `profil @${author}`); return; }
  await sleep(rand(3000, 6000));
  if (await act.followOnProfile(c.page)) {
    c.store.spend('follow');
    gs.followed_by_agent.push(author);
    actions.push('follow');
    c.log.info('react', `sleduju @${author} (2× TARGET_STRONG)`);
  } else {
    c.log.info('react', `@${author}: tlačítko Follow není (už sledovaný?)`);
  }
  c.store.save();
  await act.back(c.page);
}

/** Akce neprošla (vrátila se zpět): 2× po sobě = tichá blokace → STOP (sekce 11). */
async function failedAction(c: Ctx, what: string) {
  c.rt.failedActionsInRow++;
  c.log.warn('react', `${what} neprošel (${c.rt.failedActionsInRow}× po sobě)`);
  if (c.rt.failedActionsInRow >= 2) throw new StopSignal('silent_block', `${what} 2× po sobě neprošel`);
}

const round = (x: number) => Math.round(x * 100) / 100;
