import type { GoalConfig } from './goal.ts';
import type { GoalState, MeasureItem, Measurement, MeasurePhase, Terminal } from './store.ts';

/**
 * Metriky a vyhodnocení konečných stavů (WORKFLOW.md, sekce 13 a 15).
 * Všechno jsou čisté funkce bez prohlížeče, ať jdou otestovat.
 */

export const TARGET_HIT = 0.5;
export const OLD_HIT = 0.6;

/** 95% Wilsonův interval pro podíl p z n položek (sekce 13.2). */
export function wilson(p: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const z2 = z * z;
  const c = (p + z2 / (2 * n)) / (1 + z2 / n);
  const h = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return [Math.max(0, c - h), Math.min(1, c + h)];
}

const share = (xs: MeasureItem[], f: (x: MeasureItem) => boolean) => (xs.length ? xs.filter(f).length / xs.length : null);
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;

/** Z položek měření M spočítá T, O, interval a rozpad na feed a Explore. */
export function summarize(items: MeasureItem[], meta: { cycle: number; phase: MeasurePhase; judge_version: string; items_ref: string; ts?: string }): Measurement {
  const T = share(items, (x) => x.target_score >= TARGET_HIT) ?? 0;
  const O = share(items, (x) => x.old_topic_score >= OLD_HIT) ?? 0;
  const reels = items.filter((x) => x.kind === 'reel');
  const explore = items.filter((x) => x.kind === 'explore');
  const ci = wilson(T, items.length);
  return {
    ts: meta.ts ?? new Date().toISOString(),
    cycle: meta.cycle,
    phase: meta.phase,
    judge_version: meta.judge_version,
    n: items.length,
    T: round(T),
    T_ci: [round(ci[0]), round(ci[1])],
    T_feed: share(reels, (x) => x.target_score >= TARGET_HIT),
    T_explore: share(explore, (x) => x.target_score >= TARGET_HIT),
    O: round(O),
    items_ref: meta.items_ref,
  };
}

/** Výchozí měření M0 (první M daného cíle). */
export const baseline = (gs: GoalState) => gs.measurements.find((m) => m.phase === 'M' && m.cycle === 0) ?? gs.measurements[0];

/** Průkazné zlepšení: dolní mez T_k nad horní mezí T_0 (intervaly se nepřekrývají). */
export const significant = (m: Measurement, m0: Measurement) => m.T_ci[0] > m0.T_ci[1];

export interface CheckResult {
  /** Konečný stav, pokud nastal. */
  terminal: Terminal | null;
  /** Kam dál. */
  next: 'F1' | 'F2' | 'PERSIST_WAIT' | 'DONE';
  note: string | null;
  /** Čítače po aktualizaci (zapíšou se do GoalState). */
  counters: Pick<GoalState, 'stagnation_count' | 'success_streak' | 'persist_failures'>;
  /** Hodnoty pro log. */
  facts: { k: number; T: number; T0: number; lift: number; delta: number | null; sig: boolean; U0: number; L: number };
}

/**
 * CHECK po každém měření M (sekce 6 a 15.1). `measurement` už musí být
 * přidané v `gs.measurements`. Konečné stavy se vyhodnocují v pořadí
 * ABORTED → SUCCESS_CONFIRMED → SUCCESS → PLATEAU → NO_EFFECT → LIMIT_REACHED,
 * platí první, který sedí. CANCELLED řeší přepnutí cíle mimo CHECK.
 */
export function check(gs: GoalState, goal: GoalConfig, measurement: Measurement, opts: { hasOldTopicCreators?: boolean } = {}): CheckResult {
  const m = measurement;
  const m0 = baseline(gs) ?? m;
  const k = m.cycle;
  const sig = m !== m0 && significant(m, m0);
  const lift = m.T - m0.T;

  // 1. Čítače. Stagnace se počítá jen z běžných měření M (ne z M_persist/M_final).
  let stagnation = gs.stagnation_count;
  let delta: number | null = null;
  const prev = previousRegular(gs, m);
  if (m.phase === 'M' && prev) {
    delta = m.T - prev.T;
    stagnation = delta < 0.05 ? stagnation + 1 : 0;
  }
  const meetsSuccess = m !== m0 && m.T >= goal.target_alignment && lift >= goal.min_lift && sig;
  const streak = meetsSuccess ? gs.success_streak + 1 : 0;
  let persistFailures = gs.persist_failures;

  const facts = { k, T: m.T, T0: m0.T, lift: round(lift), delta: delta === null ? null : round(delta), sig, U0: m0.T_ci[1], L: m.T_ci[0] };
  const result = (terminal: Terminal | null, next: CheckResult['next'], note: string | null = null, over: Partial<CheckResult['counters']> = {}): CheckResult => ({
    terminal, next, note, facts,
    counters: { stagnation_count: stagnation, success_streak: streak, persist_failures: persistFailures, ...over },
  });

  // 2. Konečné stavy v pořadí.
  if (gs.cooldown_count >= 2) return result('ABORTED', 'DONE', 'druhý STOP signál v rámci cíle');

  if (m.phase === 'M_persist') {
    if (m.T >= goal.target_alignment - 0.1 && sig) return result('SUCCESS_CONFIRMED', 'DONE', 'změna vydržela bez tréninku');
    // Nedrží: zpět do běžných cyklů, streak se nuluje. Po druhém nezdaru PLATEAU.
    persistFailures += 1;
    if (persistFailures >= 2) return result('PLATEAU', 'DONE', 'změna nedrží bez tréninku', { success_streak: 0 });
    return result(null, 'F2', 'změna nevydržela, pokračuju v trénincích', { success_streak: 0 });
  }

  if (streak >= 2) {
    if (m.phase === 'M_final') return result('SUCCESS', 'DONE', 'dosažen limit, ověření trvání vynecháno');
    return goal.verify_persistence ? result('SUCCESS', 'PERSIST_WAIT') : result('SUCCESS', 'DONE');
  }

  const exhausted = stagnation >= 3 && gs.expansions >= 2;
  if (exhausted && sig) return result('PLATEAU', 'DONE', 'feed se posunul, ale další trénink nepomáhá');
  if ((k >= 6 && !sig) || (exhausted && !sig)) return result('NO_EFFECT', 'DONE', k >= 6 && !sig ? 'ani po 6 cyklech není zlepšení průkazné' : 'stagnace i po rozšíření podtémat');

  if (m.phase === 'M_final') return result('LIMIT_REACHED', 'DONE', sig ? 'zlepšení je průkazné' : 'zlepšení není průkazné');

  // 3. Žádný konečný stav.
  if (k === 0 && m.phase === 'M' && opts.hasOldTopicCreators) return result(null, 'F1');
  return result(null, 'F2');
}

function previousRegular(gs: GoalState, m: Measurement): Measurement | undefined {
  const regular = gs.measurements.filter((x) => x.phase === 'M' && x !== m);
  return regular[regular.length - 1];
}

/** Průběžné metriky z F3 (sekce 13.1): okno posledních 20 reels ze feedu. */
export function feedAlignment(reels: { source: string; target_score: number; old_topic_score: number }[], window = 20) {
  const feed = reels.filter((r) => r.source === 'feed').slice(-window);
  if (!feed.length) return { feed_alignment: null, old_topic_share: null, n: 0 };
  return {
    feed_alignment: round(feed.filter((r) => r.target_score >= TARGET_HIT).length / feed.length, 3),
    old_topic_share: round(feed.filter((r) => r.old_topic_score >= OLD_HIT).length / feed.length, 3),
    n: feed.length,
  };
}
