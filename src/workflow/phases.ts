import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chance, pause, rand, sleep } from '../human.ts';
import * as ig from '../instagram.ts';
import * as act from './actions.ts';
import type { Ctx } from './context.ts';
import { assertNoHardLimit, safety, selectorMissing, startActive, stopActive } from './guards.ts';
import { MODE_PARAMS } from './goal.ts';
import { categorize } from './judge.ts';
import { check, feedAlignment, summarize, type CheckResult } from './metrics.ts';
import { hashtagsOf, react } from './react.ts';
import type { MeasureItem, MeasurePhase, Measurement } from './store.ts';

/**
 * Fáze ze sekce 6 WORKFLOW.md. Každá fáze je async funkce nad kontextem;
 * graf (graph.ts) je spojuje podle stavového automatu.
 */

// ─────────────────────────── M: měření na studeném startu ───────────────────────────

/**
 * Protokol M: 20 dlaždic Explore (bez klikání) + 20 reels neutrálně (3–5 s,
 * bez interakce), vždy Judge se screenshotem. Uloží surová data a metriky.
 */
export async function measure(c: Ctx, phase: MeasurePhase): Promise<Measurement> {
  const gs = c.store.goal();
  const cycle = phase === 'M' ? gs.cycle : gs.cycle;
  const dir = `data/measurements/${c.goal.goal_id}/${phase}${cycle}-${Date.now()}`;
  mkdirSync(dir, { recursive: true });
  const items: MeasureItem[] = [];

  // 1. Explore: snímek mřížky, ohodnotit 20 dlaždic, na nic neklikat.
  await safety(c);
  await act.openExplore(c.page, c.exploreUrl);
  const tiles = await act.gridTiles(c.page, 20);
  if (tiles.length < 20) await act.scrollGrid(c.page);
  const all = tiles.length < 20 ? await act.gridTiles(c.page, 20) : tiles;
  if (!all.length) selectorMissing(c, 'mřížka Explore');
  c.log.info('M', `Explore: ${all.length} dlaždic, hodnotím (bez klikání)…`);
  // Snímky se berou postupně (stránka se posouvá), hodnocení běží paralelně po 2
  // (vision volání trvá ~4 s; víc najednou by mohlo narazit na limit souběhu Featherless).
  const inFlight = new Set<Promise<void>>();
  let done = 0;
  for (const t of all) {
    const shot = await act.tileScreenshot(c.page, t);
    if (shot) writeFileSync(`${dir}/explore-${t.index}.jpg`, shot);
    const p: Promise<void> = judgeWithRetry(c, { author: '', caption: t.alt, hashtags: hashtagsOf(t.alt) }, shot).then((j) => {
      c.store.addCost(j.cost_usd);
      items.push({ kind: 'explore', id: t.code, author: '', caption: t.alt.slice(0, 300), target_score: j.target_score, old_topic_score: j.old_topic_score, subtopic: j.subtopic, ...(shot ? { shot: `explore-${t.index}.jpg` } : {}) });
      done++;
      c.log.info('M', `  dlaždice ${done}/${all.length}: ${categorize(j).padEnd(13)} t=${j.target_score.toFixed(2)} ${j.via} ${j.ms} ms${j.error ? ` (${j.error.slice(0, 60)})` : ''}`);
    }).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= 2) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
  c.log.info('M', `Explore: ${items.length} dlaždic ohodnoceno`);

  // 2. Reels neutrálně: 3–5 s, žádná interakce, vždy se screenshotem.
  // Hodnocení běží na pozadí: reel se sleduje přesně 3–5 s podle hodin, i když
  // vision model odpovídá pomalu (občas 15–20 s). Na výsledky se počká na konci.
  await act.openReels(c.page, c.cfg.reelsUrl);
  const pending: Promise<void>[] = [];
  for (let i = 0; i < 20; i++) {
    await safety(c);
    const reel = await ig.readActiveReel(c.page);
    if (!reel) { selectorMissing(c, 'video reelu (M)'); await pause(1000); continue; }
    const t0 = Date.now();
    const shot = await ig.screenshotActive(c.page);
    if (shot) writeFileSync(`${dir}/reel-${i}.jpg`, shot);
    const info = { author: reel.meta.author, caption: reel.meta.caption, hashtags: hashtagsOf(reel.meta.caption), audio: reel.meta.audio };
    const n = i + 1;
    pending.push(judgeWithRetry(c, info, shot).then((j) => {
      c.store.addCost(j.cost_usd);
      items.push({ kind: 'reel', id: reel.id, author: reel.meta.author, caption: reel.meta.caption.slice(0, 300), target_score: j.target_score, old_topic_score: j.old_topic_score, subtopic: j.subtopic, ...(shot ? { shot: `reel-${n - 1}.jpg` } : {}) });
      c.events.write('reel', { cycle, phase, reel_id: reel.id, author: reel.meta.author, source: 'measure', target_score: j.target_score, old_topic_score: j.old_topic_score, category: categorize(j), actions: ['measure'], watch_s: 0 });
      c.log.info('M', `  reel ${n}/20: ${categorize(j).padEnd(13)} t=${j.target_score.toFixed(2)} @${reel.meta.author || '?'} ${j.via} ${j.ms} ms`);
    }));
    // Měření: 3–5 s skutečného času bez ohledu na přehrávání (protokol musí být pokaždé stejný).
    const left = rand(3, 5) - (Date.now() - t0) / 1000;
    if (left > 0) await sleep(left * 1000);
    if (i < 19 && !(await ig.nextReel(c.page, reel))) { selectorMissing(c, 'další reel (M)'); }
  }
  await Promise.all(pending);

  // 3. Surová data (pro přehodnocení při změně Judge).
  writeFileSync(`${dir}/items.json`, JSON.stringify(items, null, 2));
  // 4. Metriky.
  const m = summarize(items, { cycle, phase, judge_version: c.judge.version, items_ref: `${dir}/` });
  if (gs.status === 'maintaining') m.maintain = true;
  gs.measurements.push(m);
  c.store.touch();
  c.store.save();
  c.events.write('measurement', { cycle, phase, n: m.n, T: m.T, T_ci: m.T_ci, T_feed: m.T_feed, T_explore: m.T_explore, O: m.O, judge_version: m.judge_version });
  c.log.info('M', `${phase}${cycle}: T=${pct(m.T)} [${pct(m.T_ci[0])}–${pct(m.T_ci[1])}] (feed ${pct(m.T_feed)}, Explore ${pct(m.T_explore)}), O=${pct(m.O)}`);
  // 5. Kontrolní účet by se měřil stejným protokolem ve stejné hodině; v PoC není (jeden prohlížeč = jeden účet).
  if (c.goal.control_account_id) c.log.warn('M', 'control_account_id je nastavené, ale měření kontrolního účtu zatím není implementované');
  return m;
}

/**
 * Při měření nesmí chyba Judge (třeba limit souběhu) tiše započítat položku
 * jako 0: jeden opakovaný pokus po 2–4 s, pak se chyba zaloguje.
 */
async function judgeWithRetry(c: Ctx, info: Parameters<Ctx['judge']['judge']>[0], shot: Buffer | null) {
  const j = await c.judge.judge(info, shot);
  if (j.via !== 'error') return j;
  await sleep(rand(2000, 4000));
  const again = await c.judge.judge(info, shot);
  if (again.via === 'error') c.log.warn('M', `Judge selhal i podruhé: ${again.error}`);
  return again;
}

/**
 * Měření se porovnávají jen při stejné judge_version (sekce 13.2). Když se
 * Judge změnil, M0 se znovu ohodnotí z uložených položek (popisky + snímky).
 */
async function rescoreBaseline(c: Ctx): Promise<void> {
  const gs = c.store.goal();
  const idx = gs.measurements.findIndex((m) => m.phase === 'M' && m.cycle === 0);
  const m0 = gs.measurements[idx];
  if (!m0 || m0.judge_version === c.judge.version) return;

  // Ještě neproběhl žádný tréninkový cyklus a máme čerstvé M0 se současným Judge:
  // to je platný výchozí stav, starší M0 se jen archivuje (nic se nepřehodnocuje).
  const fresh = gs.measurements.at(-1);
  if (gs.cycle === 0 && fresh && fresh !== m0 && fresh.phase === 'M' && fresh.cycle === 0 && fresh.judge_version === c.judge.version) {
    const dropped = gs.measurements.filter((m) => m !== fresh && m.phase === 'M' && m.cycle === 0);
    gs.measurements = gs.measurements.filter((m) => !dropped.includes(m));
    c.store.save();
    c.events.write('baseline_replaced', { reason: 'judge_changed_before_training', dropped: dropped.map((m) => ({ T: m.T, judge_version: m.judge_version })), T: fresh.T });
    c.log.info('check', `Judge se změnil před prvním cyklem: výchozím stavem je čerstvé M0 (T=${pct(fresh.T)}), starší M0 archivováno v logu`);
    return;
  }
  const file = `${m0.items_ref}items.json`;
  if (!existsSync(file)) { c.log.warn('check', `M0 nejde přehodnotit, chybí ${file}`); return; }
  c.log.info('check', `Judge se změnil (${m0.judge_version} → ${c.judge.version}), přehodnocuju M0…`);
  const old = JSON.parse(readFileSync(file, 'utf8')) as MeasureItem[];
  const withShot = old.filter((it) => it.shot && existsSync(`${m0.items_ref}${it.shot}`)).length;
  if (withShot < old.length / 2) {
    // Bez snímků by se hodnotilo jen z (často prázdného) textu a výsledek by nebyl srovnatelný.
    c.log.warn('check', `M0 nejde spolehlivě přehodnotit (snímky jen u ${withShot}/${old.length} položek), porovnání s ním není plně srovnatelné`);
    c.events.write('rescore_skipped', { reason: 'missing_screenshots', with_shot: withShot, n: old.length });
    return;
  }
  // Po 3 najednou a s průběhem v logu (sekvenčně to s vision modelem trvalo 2–4 min bez výpisu).
  let done = 0;
  const items: MeasureItem[] = new Array(old.length);
  let next = 0;
  const worker = async () => {
    while (next < old.length) {
      const i = next++;
      const it = old[i];
      const shot = it.shot && existsSync(`${m0.items_ref}${it.shot}`) ? readFileSync(`${m0.items_ref}${it.shot}`) : null;
      // Položka bez snímku si nechá původní skóre (z textu by se hodnotila jinak než v M0).
      if (!shot) { items[i] = it; done++; continue; }
      const j = await judgeWithRetry(c, { author: it.author, caption: it.caption, hashtags: hashtagsOf(it.caption) }, shot);
      c.store.addCost(j.cost_usd);
      items[i] = { ...it, target_score: j.target_score, old_topic_score: j.old_topic_score, subtopic: j.subtopic };
      if (++done % 5 === 0 || done === old.length) c.log.info('check', `  přehodnoceno ${done}/${old.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  writeFileSync(`${m0.items_ref}items-${c.judge.version.replace(/[^\w.-]+/g, '_')}.json`, JSON.stringify(items, null, 2));
  const re = summarize(items, { cycle: 0, phase: 'M', judge_version: c.judge.version, items_ref: m0.items_ref, ts: m0.ts });
  re.rescored_from = m0.judge_version;
  gs.measurements[idx] = re;
  c.store.save();
  c.events.write('rescore', { cycle: 0, from: m0.judge_version, to: c.judge.version, T_before: m0.T, T_after: re.T });
  c.log.info('check', `M0 přehodnoceno: T ${pct(m0.T)} → ${pct(re.T)}`);
}

/** CHECK: vyhodnotí konečné stavy po M a zapíše čítače. */
export async function runCheck(c: Ctx, m: Measurement): Promise<CheckResult> {
  const gs = c.store.goal();
  await rescoreBaseline(c);
  const oldCreators = Object.values(c.store.state.goals)
    .filter((g) => g.status === 'archived' && c.goal.old_topics.some((o) => o.topic === g.target_topic))
    .some((g) => g.followed_by_agent.length > 0);
  const r = check(gs, c.goal, m, { hasOldTopicCreators: oldCreators });
  Object.assign(gs, r.counters);
  c.store.save();
  c.events.write('check', { cycle: m.cycle, phase: m.phase, ...r.facts, terminal: r.terminal, next: r.next, note: r.note, counters: r.counters });
  return r;
}

// ─────────────────────────── F1: úklid starého tématu ───────────────────────────

export async function f1Cleanup(c: Ctx): Promise<void> {
  startActive(c);
  const deadline = Date.now() + c.scale(5 * 60_000);
  const archived = Object.values(c.store.state.goals).filter((g) => g.status === 'archived' && c.goal.old_topics.some((o) => o.topic === g.target_topic));
  for (const g of archived) {
    for (const author of [...g.followed_by_agent]) {
      if (Date.now() > deadline) break;
      await safety(c);
      assertNoHardLimit(c);
      if (c.cfg.dryRun || !c.store.canSpend('unfollow', c.goal)) { c.log.info('F1', 'unfollow: dry run nebo vyčerpaný rozpočet'); return; }
      // Unfollow jen u účtů, které sledoval agent (followed_by_agent) – pravidlo 5.
      if (!(await act.openProfile(c.page, author))) { selectorMissing(c, `profil @${author}`); continue; }
      if (await act.unfollowOnProfile(c.page)) {
        c.store.spend('unfollow');
        g.followed_by_agent = g.followed_by_agent.filter((x) => x !== author);
        g.unfollowed_by_agent.push(author);
        c.store.save();
        c.events.write('unfollow', { author, from_goal_topic: g.target_topic });
        c.log.info('F1', `přestal jsem sledovat @${author}`);
      } else selectorMissing(c, `Unfollow @${author}`);
      await sleep(c.scale(rand(15_000, 45_000)));
    }
  }
  if (c.goal.reset_recommendations) {
    // Reset doporučení smí zapnout jen orchestrátor po potvrzení uživatelem. V PoC se jen zaloguje.
    c.log.warn('F1', 'reset_recommendations je zapnutý, ale reset přes web zatím není implementovaný');
  }
}

// ─────────────────────────── F2: start hledáním + startovní reels + tvůrci ───────────────────────────

export async function f2Search(c: Ctx, full: boolean): Promise<void> {
  startActive(c);
  const gs = c.store.goal();
  // V režimu rychlého iterování (--iterate) menší F2, ať cyklus netrvá 20 min.
  const quick = isQuick(c);
  const n = quick ? (full ? 2 : 1) : full ? Math.round(rand(3, 5)) : Math.round(rand(1, 2));
  const queries = pickQueries(c, n);
  c.log.info('F2', `${full ? 'plná' : 'zkrácená'} verze, dotazy: ${queries.map((q) => `„${q}“`).join(', ') || '–'}`);

  for (const q of queries) {
    await safety(c);
    assertNoHardLimit(c);
    if (c.cfg.reelsUrl.startsWith('file:')) { c.log.info('F2', `hledání „${q}“ přeskočeno (testovací stránka nemá vyhledávání)`); continue; }
    if (c.cfg.dryRun || !c.store.canSpend('search', c.goal)) { c.log.info('F2', 'hledání: dry run nebo vyčerpaný rozpočet'); break; }
    if (!(await act.search(c.page, q))) { selectorMissing(c, `výsledky hledání „${q}“`); continue; }
    c.store.spend('search');
    gs.used_queries.push({ query: q, ts: new Date().toISOString() });
    c.rt.queriesThisSession.push(q);
    c.store.save();
    await sleep(rand(2000, 4000));
    const tiles = (await act.gridTiles(c.page, 5)).slice(0, quick ? 2 : Math.round(rand(3, 5)));
    for (const t of tiles) {
      await safety(c);
      // Hodnocení z alt textu dlaždice začne už před kliknutím (otevření trvá ~2,5 s).
      const hint = tileHint(c, t);
      if (!(await act.openTile(c.page, t))) continue;
      await react(c, 'F2', 'search', { hint });
      await act.back(c.page);
    }
    await sleep(c.scale(rand(5000, 15000)));
  }

  if (seedsApply(c)) await seedsPhase(c);

  // Tvůrci z Discovery: 1–3, projít profil, 2–3 reels, follow když aspoň 2 jsou TARGET_STRONG.
  const creators = quick ? 1 : Math.round(rand(1, 3));
  for (let i = 0; i < creators && c.discovery.available; i++) {
    await safety(c);
    assertNoHardLimit(c);
    const author = c.discovery.nextCreator(gs.followed_by_agent);
    if (!author) break;
    if (!(await act.openProfile(c.page, author))) { selectorMissing(c, `profil @${author}`); continue; }
    await sleep(rand(3000, 6000));
    let strong = 0;
    for (const t of (await act.gridTiles(c.page, 3)).slice(0, Math.round(rand(2, 3)))) {
      const hint = tileHint(c, t);
      if (!(await act.openTile(c.page, t))) continue;
      const o = await react(c, 'F2', 'profile', { hint });
      if (o?.category === 'TARGET_STRONG') strong++;
      await act.back(c.page);
    }
    if (strong >= 2 && !c.cfg.dryRun && !gs.followed_by_agent.includes(author) && c.store.canSpend('follow', c.goal)) {
      if (await act.followOnProfile(c.page)) {
        c.store.spend('follow');
        gs.followed_by_agent.push(author);
        c.store.save();
        c.events.write('follow', { author, why: 'discovery', strong });
        c.log.info('F2', `sleduju @${author} z Discovery (${strong}× TARGET_STRONG)`);
      }
    }
    await act.back(c.page);
  }
}

function pickQueries(c: Ctx, n: number): string[] {
  const gs = c.store.goal();
  const dayAgo = Date.now() - 86_400_000;
  const recent = new Set(gs.used_queries.filter((q) => Date.parse(q.ts) > dayAgo).map((q) => q.query));
  const pool = [...c.goal.subtopics, ...gs.extra_subtopics].filter((s) => !recent.has(s) && !c.rt.queriesThisSession.includes(s));
  // Střídat jazyky: en/cs varianta, když existuje (jednoduše: podtémata jsou zadaná v různých jazycích).
  return shuffle(pool).slice(0, n);
}

/** Textové hodnocení dlaždice z alt textu (Instagram tam dává popisek), spuštěné před otevřením. */
function tileHint(c: Ctx, t: act.Tile) {
  if (!t.alt.trim()) return undefined;
  const p = c.judge.judge({ author: '', caption: t.alt, hashtags: hashtagsOf(t.alt) });
  void p.then((j) => c.store.addCost(j.cost_usd));
  return p;
}

// ─────────────────────────── Startovní reels (sekce 14) ───────────────────────────

function seedsApply(c: Ctx): boolean {
  const gs = c.store.goal();
  if (!c.goal.seeds_enabled || gs.status === 'maintaining' || !c.discovery.available) return false;
  const lastT = gs.measurements.filter((m) => m.phase === 'M').at(-1)?.T ?? 0;
  const stagnating = gs.last_expansion_cycle === gs.cycle; // F5 právě vyhodnotil stagnaci (pravidlo 4)
  return gs.cycle <= 1 || stagnating || lastT < 0.2;
}

async function seedsPhase(c: Ctx): Promise<void> {
  const gs = c.store.goal();
  const refill = await c.discovery.refill(gs.used_seeds, [...c.goal.subtopics, ...gs.extra_subtopics], (m) => c.log.info('F2', m));
  c.store.addCost(refill.cost_usd);
  if (refill.added) c.log.info('F2', `Discovery: +${refill.added} ověřených startovních reels`);

  const [lo, hi] = MODE_PARAMS[c.goal.mode].seeds;
  let count = isQuick(c) ? Math.min(2, lo) : Math.round(rand(lo, hi));
  if (gs.seed_chain_mode === 'none' && gs.cycle >= 2) count = Math.min(count, 2);
  let opened = 0;
  for (let i = 0; i < count; i++) {
    await safety(c);
    assertNoHardLimit(c);
    if (c.cfg.dryRun || !c.store.canSpend('seed_open', c.goal)) { c.log.info('F2', 'startovní reels: dry run nebo vyčerpaný rozpočet'); break; }
    const today = new Date().toISOString().slice(0, 10);
    const authorsToday = gs.seed_history.filter((h) => h.ts.startsWith(today)).map((h) => h.author);
    const seed = c.discovery.nextSeed(gs.used_seeds, authorsToday);
    if (!seed) { c.log.info('F2', 'fronta startovních reels je prázdná'); break; }

    // Nikdy víc než 2 startovní reels těsně po sobě bez jiné aktivity (14.3).
    if (opened >= 2 && chance(0.7)) { await interlude(c); opened = 0; }
    await c.page.goto(seed.url, { waitUntil: 'domcontentloaded' });
    c.store.spend('seed_open');
    await sleep(rand(1000, 3000));
    await react(c, 'F2', 'seed', { seed });
    gs.used_seeds.push(seed.reel_id);
    gs.seed_history.push({ reel_id: seed.reel_id, author: seed.author, ts: new Date().toISOString() });
    c.store.save();
    opened++;

    // Navazující reels: 5–10, dřív konec po 3 netématických po sobě.
    if (gs.seed_chain_mode !== 'none') {
      const chain = isQuick(c) ? 3 : Math.round(rand(5, 10));
      let offTopic = 0, done = 0;
      for (let k = 0; k < chain; k++) {
        const prev = await ig.readActiveReel(c.page);
        if (!prev || !(await ig.nextReel(c.page, prev))) {
          gs.seed_chain_mode = 'none';
          c.log.warn('F2', 'web po startovním reelu nepokračuje navazujícími reels (seed_chain_mode = none)');
          break;
        }
        const o = await react(c, 'F2', 'seed_chain', { seedId: seed.reel_id });
        done++;
        offTopic = o && o.category.startsWith('TARGET') ? 0 : offTopic + 1;
        if (offTopic >= 3) break;
      }
      if (done > 0 && gs.seed_chain_mode === 'unknown') gs.seed_chain_mode = 'chain';
      c.store.save();
    }
    await sleep(c.scale(rand(5000, 20000)));
  }
}

/** Jiná aktivita mezi startovními reels: krátce Explore. */
async function interlude(c: Ctx) {
  c.log.info('F2', 'mezihra: krátce Explore');
  await act.openExplore(c.page, c.exploreUrl);
  await act.scrollGrid(c.page);
  await sleep(rand(3000, 8000));
}

// ─────────────────────────── F3: smyčka reels ───────────────────────────

export async function f3Reels(c: Ctx, minutes: [number, number] = [15, 20]): Promise<void> {
  startActive(c);
  const until = Date.now() + c.scale(rand(minutes[0], minutes[1]) * 60_000);
  await act.openReels(c.page, c.cfg.reelsUrl);
  let feedCount = 0;
  while (Date.now() < until) {
    assertNoHardLimit(c);
    const o = await react(c, 'F3', 'feed');
    if (o) {
      feedCount++;
      if (feedCount % 20 === 0) {
        const fa = feedAlignment(c.rt.cycleReels);
        c.events.write('feed_alignment', { cycle: c.store.goal().cycle, ...fa });
        c.log.info('F3', `průběžný feed_alignment ${pct(fa.feed_alignment)} (staré téma ${pct(fa.old_topic_share)}) z ${fa.n} reels`);
      }
    }
    const prev = await ig.readActiveReel(c.page);
    if (!prev) { await pause(1000); continue; }
    if (!(await ig.nextReel(c.page, prev))) selectorMissing(c, 'další reel');
  }
}

// ─────────────────────────── F4: Explore ───────────────────────────

export async function f4Explore(c: Ctx): Promise<void> {
  startActive(c);
  await safety(c);
  await act.openExplore(c.page, c.exploreUrl);
  // Horké měření před interakcí (jen pro log).
  const tiles = await act.gridTiles(c.page, 20);
  const scored: { t: (typeof tiles)[number]; target: number; old: number; evidence: boolean }[] = [];
  for (const t of tiles) {
    const j = await c.judge.judge({ author: '', caption: t.alt, hashtags: hashtagsOf(t.alt) });
    c.store.addCost(j.cost_usd);
    scored.push({ t, target: j.target_score, old: j.old_topic_score, evidence: j.evidence });
  }
  const n = scored.length || 1;
  c.rt.exploreHot = {
    alignment: scored.length ? scored.filter((s) => s.target >= 0.5).length / n : null,
    old: scored.length ? scored.filter((s) => s.old >= 0.6).length / n : null,
  };
  c.log.info('F4', `Explore (horké): ${pct(c.rt.exploreHot.alignment)} k tématu, ${pct(c.rt.exploreHot.old)} staré téma`);

  for (let round = 0; round < (chance(0.5) ? 2 : 1); round++) {
    const best = scored.filter((s) => s.target >= 0.8).sort((a, b) => b.target - a.target).slice(0, Math.round(rand(3, 5)));
    for (const b of best) {
      await safety(c);
      assertNoHardLimit(c);
      if (!(await act.openTile(c.page, b.t))) continue;
      // Dlaždice už má skóre z horkého měření, použije se jako nápověda.
      await react(c, 'F4', 'explore', { hint: Promise.resolve({ target_score: b.target, old_topic_score: b.old, subtopic: '', reason: 'z mřížky Explore', via: 'prefetch', ms: 0, cost_usd: 0, evidence: b.evidence }) });
      await act.back(c.page);
    }
    if (round === 0) await act.scrollGrid(c.page);
  }
  stopActive(c);
  const gs = c.store.goal();
  // Dokončený cyklus F2–F4. Cykly v MAINTAIN se do max_cycles nepočítají (sekce 15.3).
  if (gs.status !== 'maintaining') gs.cycle += 1;
  c.store.state.budgets.cycles_today += 1;
  c.store.save();
}

// ─────────────────────────── F5: plán dalšího cyklu ───────────────────────────

export type F5Next = 'PAUSE' | 'PAUSE_DAY' | 'FINAL_M';

export function f5Plan(c: Ctx, inActive: boolean, hardLimit: string | null): { next: F5Next; f2Full: boolean; reason: string } {
  const gs = c.store.goal();
  const fa = feedAlignment(c.rt.cycleReels);
  const chain = c.rt.cycleReels.filter((r) => r.source === 'seed_chain');
  const seedChainAlignment = chain.length ? chain.filter((r) => r.target_score >= 0.5).length / chain.length : null;
  const summary = { feed_alignment: fa.feed_alignment, old_topic_share: fa.old_topic_share, explore_alignment: c.rt.exploreHot.alignment, explore_old_share: c.rt.exploreHot.old, seed_chain_alignment: seedChainAlignment };

  let next: F5Next, f2Full = false, reason: string;
  if (hardLimit) { next = 'FINAL_M'; reason = `hard limit ${hardLimit}`; }
  else if (c.store.cyclesLeftToday(c.goal) <= 0 || !inActive) { next = 'PAUSE_DAY'; reason = !inActive ? 'mimo active_hours' : 'denní limit cyklů'; }
  else if (gs.stagnation_count >= 2 && (gs.last_expansion_cycle === null || gs.cycle - gs.last_expansion_cycle > 2)) {
    const fresh = expandSubtopics(c);
    gs.extra_subtopics.push(...fresh);
    gs.expansions += 1;
    gs.last_expansion_cycle = gs.cycle;
    next = 'PAUSE'; f2Full = true; reason = `stagnace → nová podtémata: ${fresh.join(', ') || '–'}`;
  } else { next = 'PAUSE'; reason = 'další cyklus'; }

  c.store.save();
  c.events.write('cycle_summary', { cycle: gs.cycle, ...summary, next: `${next}${next === 'PAUSE' ? (f2Full ? '->F2_full' : '->F2_short') : ''}`, reason });
  c.rt.cycleReels = [];
  return { next, f2Full, reason };
}

/**
 * Rozšíření podtémat (discovery_new_subtopics): nejčastější hashtagy
 * z reels, které byly k tématu, a které ještě nejsou mezi podtématy.
 */
function expandSubtopics(c: Ctx): string[] {
  const known = new Set([...c.goal.subtopics, ...c.store.goal().extra_subtopics].map((s) => s.toLowerCase()));
  const counts = new Map<string, number>();
  for (const r of c.rt.cycleReels) {
    if (r.target_score < 0.8) continue;
    for (const h of r.hashtags) if (!known.has(h) && h.length > 2) counts.set(h, (counts.get(h) ?? 0) + 1);
    if (r.subtopic && !known.has(r.subtopic.toLowerCase())) counts.set(r.subtopic, (counts.get(r.subtopic) ?? 0) + 2);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([h]) => h);
}

// ─────────────────────────── pomocné ───────────────────────────

/** Rychlé iterování (--iterate, timeScale < 1): menší fáze, protokol M a tempo reakcí beze změny. */
const isQuick = (c: Ctx) => c.scale(1000) < 1000;

export const pct = (x: number | null | undefined) => (x === null || x === undefined ? '–' : `${Math.round(x * 100)} %`);

function shuffle<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
