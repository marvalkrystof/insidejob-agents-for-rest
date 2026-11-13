import { Annotation, END, START, StateGraph, type LangGraphRunnableConfig } from '@langchain/langgraph';
import { pause, rand, sleep } from '../human.ts';
import { HardLimitHit, SessionEnd, StopSignal, type Ctx } from './context.ts';
import { activeNow, FINAL_M_MEASURE_MS, hardLimit, stopActive } from './guards.ts';
import { nextActiveStart } from './goal.ts';
import { f1Cleanup, f2Search, f3Reels, f4Explore, f5Plan, measure, pct, runCheck } from './phases.ts';
import { buildReport } from './report.ts';
import type { MeasurePhase, Terminal } from './store.ts';

/**
 * Stavový automat z WORKFLOW.md (sekce 6) jako graf v LangGraph.
 *
 *   start → M → CHECK ─┬─ F1 → F2 → F3 → F4 → F5 ─┬─ PAUSE → M
 *                      ├─ F2 …                     ├─ PAUSE_DAY → M
 *                      ├─ PERSIST_WAIT → M_PERSIST └─ FINAL_M → CHECK
 *                      └─ DONE → REPORT ─┬─ MAINTAIN → (konec session)
 *                                        └─ END
 *   Z jakéhokoli uzlu: STOP (sekce 11) → cooldown / ABORTED, hard limit → FINAL_M,
 *   konec session (Ctrl+C, selector_missing 5×, neviditelná karta) → END.
 *
 * Trvalý stav (rozpočty, měření, čítače) je ve Store (data/state.json);
 * stav grafu nese jen řízení: kam dál a s jakými parametry.
 */
type Node =
  | 'start' | 'measure' | 'check' | 'f1' | 'f2' | 'f3' | 'f4' | 'f5' | 'pause' | 'pauseDay'
  | 'persistWait' | 'finalM' | 'stop' | 'report' | 'maintain' | 'end';

const last = <T>(d: () => T) => Annotation<T>({ reducer: (_a, b) => b, default: d });

export const FlowState = Annotation.Root({
  route: last<Node>(() => 'start'),
  measurePhase: last<MeasurePhase>(() => 'M'),
  // Plná F2 jen v prvním cyklu (řeší cycle === 0) a po stagnaci (nastaví F5).
  f2Full: last<boolean>(() => false),
  terminal: last<Terminal | null>(() => null),
  note: last<string>(() => ''),
  sessionEnd: last<string>(() => ''),
});
type S = typeof FlowState.State;
type U = Partial<S>;

const ctx = (config: LangGraphRunnableConfig) => (config.configurable as unknown as { ctx: Ctx }).ctx;

/** Obal uzlu: log vstupu/výstupu a převod signálů (STOP, hard limit, konec session) na přechody. */
function node(name: string, fn: (s: S, c: Ctx) => Promise<U>) {
  return async (s: S, config: LangGraphRunnableConfig): Promise<U> => {
    const c = ctx(config);
    c.log.enter(name, `cyklus ${c.store.goal().cycle}`);
    const t0 = performance.now();
    try {
      const u = await fn(s, c);
      c.log.exit(name, performance.now() - t0, `→ ${u.route ?? '?'}${u.note ? ` (${u.note})` : ''}`, u);
      return u;
    } catch (err) {
      stopActive(c);
      if (err instanceof StopSignal) {
        c.log.error(name, `STOP: ${err.kind}: ${err.message}`);
        return { route: 'stop', note: `${err.kind}: ${err.message}` };
      }
      if (err instanceof HardLimitHit) {
        c.log.warn(name, `${err.message} → dokončuju a jdu na FINAL_M`);
        return { route: 'finalM', note: err.limit };
      }
      if (err instanceof SessionEnd) {
        c.log.warn(name, `konec session: ${err.message}`);
        c.events.write('session_end', { reason: err.message });
        return { route: 'end', sessionEnd: err.message };
      }
      c.log.error(name, (err as Error).message, { stack: (err as Error).stack });
      c.events.write('error', { node: name, message: (err as Error).message });
      return { route: 'end', sessionEnd: `chyba v ${name}: ${(err as Error).message}` };
    }
  };
}

/** M je vždy první činnost session a předchází jí pauza aspoň 10 minut (sekce 6, M). */
async function coldStart(c: Ctx) {
  const lastAt = c.store.state.last_activity_at ? Date.parse(c.store.state.last_activity_at) : 0;
  const wait = c.scale(10 * 60_000) - (Date.now() - lastAt);
  if (lastAt && wait > 0) {
    c.log.info('M', `studený start: čekám ještě ${Math.round(wait / 1000)} s od poslední aktivity`);
    await c.page.goto('about:blank');
    await sleep(wait);
  }
}

const start = node('start', async (_s, c) => {
  const st = c.store.state;
  const gs = c.store.goal();
  if (st.cooldown_until && Date.now() < Date.parse(st.cooldown_until)) {
    return { route: 'end', sessionEnd: `cooldown do ${st.cooldown_until}`, note: 'cooldown' };
  }
  if (gs.terminal && gs.status !== 'maintaining') return { route: 'end', sessionEnd: `cíl už skončil: ${gs.terminal}` };
  if (gs.status === 'persist_wait') {
    if (gs.persist_wait_until && Date.now() < Date.parse(gs.persist_wait_until)) {
      return { route: 'end', sessionEnd: `ověření trvání: bez tréninku do ${gs.persist_wait_until}` };
    }
    return { route: 'measure', measurePhase: 'M_persist' };
  }
  if (gs.status === 'maintaining') return { route: 'maintain' };
  if (!activeNow(c)) return { route: 'pauseDay' };
  return { route: 'measure', measurePhase: 'M' };
});

const measureNode = node('measure', async (s, c) => {
  await coldStart(c);
  const m = await measure(c, s.measurePhase);
  return { route: 'check', note: `${s.measurePhase}${m.cycle}: T=${pct(m.T)}` };
});

const checkNode = node('check', async (_s, c) => {
  const gs = c.store.goal();
  const m = gs.measurements.at(-1)!;
  const r = await runCheck(c, m);
  c.log.info('check', `T=${pct(r.facts.T)} vs T0=${pct(r.facts.T0)}, lift ${pct(r.facts.lift)}, průkazné: ${r.facts.sig ? 'ano' : 'ne'} (L=${pct(r.facts.L)} vs U0=${pct(r.facts.U0)}), stagnace ${r.counters.stagnation_count}, streak ${r.counters.success_streak}`);

  if (gs.status === 'maintaining') return maintainCheck(c, m.T);

  if (r.terminal === 'SUCCESS' && r.next === 'PERSIST_WAIT') {
    gs.terminal = null; // SUCCESS se ještě ověřuje; konečný stav padne po M_PERSIST
    gs.status = 'persist_wait';
    gs.persist_wait_until = new Date(Date.now() + c.scale(12 * 3_600_000)).toISOString();
    c.store.save();
    c.events.write('persist_wait', { until: gs.persist_wait_until });
    return { route: 'persistWait', note: 'SUCCESS, ověřuju trvání' };
  }
  if (r.terminal) return { route: 'report', terminal: r.terminal, note: r.note ?? '' };
  if (r.next === 'F1') return { route: 'f1' };
  // Po nevydrženém M_PERSIST zpět do běžných cyklů.
  if (m.phase === 'M_persist') { gs.status = 'active'; gs.persist_wait_until = null; c.store.save(); }
  return { route: 'f2', note: r.note ?? '' };
});

/** MAINTAIN: T pod cílem − 0,1 ve 2 měřeních po sobě → zpět do běžných cyklů s rozpočtem 4 cyklů. */
function maintainCheck(c: Ctx, T: number): U {
  const gs = c.store.goal();
  gs.maintain_low_streak = T < c.goal.target_alignment - 0.1 ? gs.maintain_low_streak + 1 : 0;
  if (gs.maintain_low_streak >= 2) {
    gs.status = 'active';
    gs.terminal = null;
    gs.maintain_low_streak = 0;
    gs.extra_cycles = Math.max(0, gs.cycle + 4 - c.goal.limits.max_cycles);
    c.store.save();
    c.events.write('maintain_exit', { T, extra_cycles: gs.extra_cycles });
    return { route: 'f2', f2Full: true, note: 'udržování nestačí, zpět k tréninku' };
  }
  c.store.save();
  return { route: 'f3', note: 'udržování' };
}

const f1 = node('f1', async (_s, c) => { await f1Cleanup(c); return { route: 'f2', f2Full: true }; });
const f2 = node('f2', async (s, c) => { await f2Search(c, s.f2Full || c.store.goal().cycle === 0); return { route: 'f3' }; });
const f3 = node('f3', async (_s, c) => {
  const maintaining = c.store.goal().status === 'maintaining';
  await f3Reels(c, maintaining ? [10, 10] : [15, 20]);
  return { route: 'f4' };
});
const f4 = node('f4', async (_s, c) => { await f4Explore(c); return { route: 'f5' }; });

const f5 = node('f5', async (_s, c) => {
  const gs = c.store.goal();
  if (gs.status === 'maintaining') {
    // V udržování 1–2 krátké cykly denně, mezi nimi pauza do dalšího dne.
    const day = c.store.state.budgets.cycles_today >= 2 || Math.random() < 0.5;
    return day ? { route: 'pauseDay', note: 'udržování' } : { route: 'pause', note: 'udržování' };
  }
  const p = f5Plan(c, activeNow(c), hardLimit(c));
  c.log.info('f5', p.reason);
  if (p.next === 'FINAL_M') return { route: 'finalM', note: p.reason };
  if (p.next === 'PAUSE_DAY') return { route: 'pauseDay', note: p.reason, f2Full: false };
  return { route: 'pause', f2Full: p.f2Full, note: p.reason };
});

const pauseNode = node('pause', async (_s, c) => {
  const ms = c.scale(rand(10, 30) * 60_000);
  c.log.info('pause', `pauza ${Math.round(ms / 1000)} s, karta zavřená`);
  await c.page.goto('about:blank');
  await sleep(ms);
  return { route: 'measure', measurePhase: 'M' };
});

const pauseDay = node('pauseDay', async (_s, c) => {
  const at = c.cfg.reelsUrl.startsWith('file:') ? new Date(Date.now() + c.scale(60_000)) : nextActiveStart(c.goal);
  const ms = Math.max(0, at.getTime() - Date.now());
  c.log.info('pauseDay', `čekám do ${at.toISOString()} (${Math.round(ms / 60_000)} min)`);
  await c.page.goto('about:blank');
  await sleepAbortable(c, ms);
  return { route: 'measure', measurePhase: 'M' };
});

/** PERSIST_WAIT: aspoň 12 h bez tréninku. Session tady končí; další spuštění po 12 h udělá M_PERSIST. */
const persistWait = node('persistWait', async (_s, c) => {
  const gs = c.store.goal();
  const until = Date.parse(gs.persist_wait_until ?? new Date().toISOString());
  if (c.cfg.reelsUrl.startsWith('file:') || until - Date.now() < 5 * 60_000) {
    await c.page.goto('about:blank');
    await sleepAbortable(c, Math.max(0, until - Date.now()));
    return { route: 'measure', measurePhase: 'M_persist' };
  }
  c.notify(`Cíl splněný, ověřuju, že změna vydrží. Spusť agenta znovu po ${gs.persist_wait_until}.`);
  return { route: 'end', sessionEnd: `ověření trvání: další spuštění po ${gs.persist_wait_until}` };
});

const finalM = node('finalM', async (s, c) => {
  const gs = c.store.goal();
  const hs = c.goal.limits.hard_stop_at ? Date.parse(c.goal.limits.hard_stop_at) : null;
  const wait = c.scale(30 * 60_000);
  // FINAL_M by skončilo po hard_stop_at → vynechat a použít poslední M.
  const measureMs = FINAL_M_MEASURE_MS;
  if (hs && Date.now() + wait + measureMs > hs) {
    c.log.warn('finalM', 'FINAL_M by nestihlo hard_stop_at, beru poslední M');
    const r = await runCheck(c, { ...gs.measurements.at(-1)!, phase: 'M_final' });
    return { route: 'report', terminal: r.terminal ?? 'LIMIT_REACHED', note: `${s.note}; FINAL_M vynecháno` };
  }
  c.log.info('finalM', `pauza ${Math.round(wait / 1000)} s před závěrečným měřením`);
  await c.page.goto('about:blank');
  await sleep(wait);
  c.store.state.last_activity_at = null; // pauza už proběhla
  return { route: 'measure', measurePhase: 'M_final' };
});

/** STOP (sekce 11): cooldown, notify; druhý STOP v rámci cíle → ABORTED. */
const stopNode = node('stop', async (s, c) => {
  const gs = c.store.goal();
  const kind = s.note.split(':')[0];
  const hours = kind === 'silent_block' ? 24 : kind === 'action_blocked' ? 48 : 24;
  gs.cooldown_count += 1;
  c.store.state.cooldown_until = new Date(Date.now() + hours * 3_600_000).toISOString();
  c.store.save();
  c.events.write('stop', { reason: kind, detail: s.note, cooldown_until: c.store.state.cooldown_until, cooldown_count: gs.cooldown_count });
  c.notify(`STOP: ${s.note}. Cooldown ${hours} h (do ${c.store.state.cooldown_until}). Nic nezadávej, na účet se teď nesahá.`);
  if (gs.cooldown_count >= 2) return { route: 'report', terminal: 'ABORTED', note: 'druhý STOP signál v rámci cíle' };
  return { route: 'end', sessionEnd: `STOP ${kind}, cooldown ${hours} h` };
});

const reportNode = node('report', async (s, c) => {
  const gs = c.store.goal();
  const t = s.terminal!;
  gs.terminal = t;
  gs.terminal_note = s.note || null;
  const report = buildReport({ goal: c.goal, gs, actions: c.store.state.budgets.used, rt: c.rt }, t, s.note);
  gs.report = report;
  const maintain = (t === 'SUCCESS' || t === 'SUCCESS_CONFIRMED') && c.goal.on_success === 'maintain';
  gs.status = maintain ? 'maintaining' : 'done';
  c.store.save();
  c.events.write('terminal', { terminal: t, report_ref: `${c.store.file}#goals.${c.goal.goal_id}.report` });
  c.notify(report.summary_cs);
  return { route: maintain ? 'maintain' : 'end', terminal: t, sessionEnd: `konečný stav ${t}` };
});

/** MAINTAIN: M → F3 (10 min) → F4, 1–2× denně. Konec jen zrušením nebo přepnutím cíle. */
const maintain = node('maintain', async (_s, c) => {
  if (!activeNow(c)) return { route: 'pauseDay' };
  return { route: 'measure', measurePhase: 'M', note: 'udržování' };
});

async function sleepAbortable(c: Ctx, ms: number) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (c.signal?.aborted) throw new SessionEnd('přerušeno uživatelem (Ctrl+C)');
    await pause(Math.min(30_000, until - Date.now()), 0.01);
  }
}

type Target = Exclude<Node, 'end' | 'start'>;
const route = (s: S): Target | typeof END => (s.route === 'end' || s.route === 'start' ? END : s.route);
const ALL: (Target | typeof END)[] = ['measure', 'check', 'f1', 'f2', 'f3', 'f4', 'f5', 'pause', 'pauseDay', 'persistWait', 'finalM', 'stop', 'report', 'maintain', END];

export function buildWorkflow() {
  const g = new StateGraph(FlowState)
    .addNode('start', start)
    .addNode('measure', measureNode)
    .addNode('check', checkNode)
    .addNode('f1', f1)
    .addNode('f2', f2)
    .addNode('f3', f3)
    .addNode('f4', f4)
    .addNode('f5', f5)
    .addNode('pause', pauseNode)
    .addNode('pauseDay', pauseDay)
    .addNode('persistWait', persistWait)
    .addNode('finalM', finalM)
    .addNode('stop', stopNode)
    .addNode('report', reportNode)
    .addNode('maintain', maintain)
    .addEdge(START, 'start');
  // Každý uzel může skončit STOPem, hard limitem nebo koncem session, proto má každý všechny cíle.
  for (const n of ['start', 'measure', 'check', 'f1', 'f2', 'f3', 'f4', 'f5', 'pause', 'pauseDay', 'persistWait', 'finalM', 'stop', 'report', 'maintain'] as const) {
    g.addConditionalEdges(n, route, ALL);
  }
  return g.compile();
}
