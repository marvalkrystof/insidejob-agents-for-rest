import type { Page } from 'patchright';
import type { Config } from '../config.ts';
import { AgentLog } from '../log.ts';
import { newRuntime, type Ctx } from './context.ts';
import { Discovery } from './discovery.ts';
import { EventLog } from './events.ts';
import type { GoalConfig } from './goal.ts';
import { buildWorkflow } from './graph.ts';
import { Judge } from './judge.ts';
import { buildReport } from './report.ts';
import { newGoalState, Store } from './store.ts';

export interface RunOptions {
  page: Page;
  cfg: Config;
  goal: GoalConfig;
  stateFile?: string;
  dataDir?: string;
  exploreUrl?: string;
  /** Zrychlení dlouhých čekání (pro test); 1 = skutečný čas. */
  timeScale?: number;
  signal?: AbortSignal;
  consoleLog?: 'steps' | 'quiet' | 'off';
}

/**
 * Spustí jednu session podle WORKFLOW.md. Trvalý stav je v `data/state.json`,
 * takže další spuštění naváže (cooldown, PERSIST_WAIT, MAINTAIN, rozpočty).
 */
export async function runWorkflow(o: RunOptions) {
  const session = new Date().toISOString().replace(/[:.]/g, '-');
  const dataDir = o.dataDir ?? 'data';
  const store = new Store(o.stateFile ?? `${dataDir}/state.json`);
  const log = new AgentLog({ session, file: `logs/steps-${session}.jsonl`, console: o.consoleLog ?? 'steps' });
  const judge = new Judge(o.goal, { apiKey: o.cfg.featherlessKey, textModel: o.cfg.textModel, visionModel: o.cfg.visionModel });
  const events = new EventLog(`logs/events-${o.goal.goal_id}.jsonl`, { goal_id: o.goal.goal_id });
  const scale = o.timeScale ?? 1;
  const notify = (msg: string) => { log.warn('notify', msg); events.write('notify', { msg }); };

  const goal = switchGoal(store, o.goal, { log, notify, judgeVersion: judge.version, events });

  const c: Ctx = {
    page: o.page, cfg: o.cfg, goal, store, judge,
    discovery: new Discovery(goal, judge, o.cfg.apifyToken, dataDir),
    log, events, rt: newRuntime(),
    scale: (ms) => ms * scale,
    signal: o.signal,
    exploreUrl: o.exploreUrl ?? 'https://www.instagram.com/explore/',
    notify,
  };
  log.info('session', `cíl ${goal.goal_id} („${goal.target_topic}“), režim ${goal.mode}, Judge ${judge.version}, stav ${store.goal().status}`);

  let final: Record<string, unknown> = {};
  const stream = await buildWorkflow().stream({}, {
    configurable: { ctx: c, thread_id: session },
    recursionLimit: 100_000,
    streamMode: 'values',
  });
  for await (const st of stream) final = st as Record<string, unknown>;
  store.save();
  return { final, store, goalState: store.goal(), stepsFile: log.file, eventsFile: events.file };
}

/**
 * Přepnutí cíle (sekce 6, "Přepnutí cíle"): když je aktivní jiný cíl a ještě
 * neskončil, dostane CANCELLED a zprávu z posledního M, archivuje se (jeho
 * followed_by_agent zůstane) a jeho téma se přidá do old_topics nového cíle.
 */
function switchGoal(store: Store, goal: GoalConfig, h: { log: AgentLog; notify: (m: string) => void; judgeVersion: string; events: EventLog }): GoalConfig {
  const st = store.state;
  const prevId = st.active_goal_id;
  let g = goal;
  if (prevId && prevId !== goal.goal_id && st.goals[prevId]) {
    const prev = st.goals[prevId];
    if (!prev.terminal) {
      prev.terminal = 'CANCELLED';
      prev.terminal_note = `přepnuto na ${goal.goal_id}`;
      prev.report = buildReport(
        {
          goal: { ...goal, goal_id: prevId, target_topic: prev.target_topic, old_topics: [] },
          gs: prev,
          actions: st.budgets.used,
          rt: { selectorMissing: 0, missingCapabilities: new Set(), subtopicHits: {} },
        },
        'CANCELLED',
        'přepnutí cíle',
      );
      h.notify(`Cíl ${prevId} zrušen (CANCELLED), přepínám na ${goal.goal_id}.`);
    }
    prev.status = 'archived';
    if (!g.old_topics.some((o) => o.topic === prev.target_topic)) {
      g = { ...g, old_topics: [...g.old_topics, { topic: prev.target_topic, description: prev.target_topic }] };
    }
    h.log.info('session', `archivován cíl ${prevId}, „${prev.target_topic}“ je teď staré téma`);
  }
  if (!st.goals[g.goal_id]) {
    st.goals[g.goal_id] = newGoalState(g);
    h.events.write('goal_start', { target_topic: g.target_topic, mode: g.mode, judge_version: h.judgeVersion });
  }
  st.active_goal_id = g.goal_id;
  store.save();
  return g;
}
