import type { SessionRuntime } from './context.ts';
import type { GoalConfig } from './goal.ts';
import { baseline, significant } from './metrics.ts';
import type { GoalState, Measurement, Terminal } from './store.ts';

/** Co zpráva potřebuje: cíl, jeho trvalý stav, použité akce a souhrn session. */
export interface ReportInput {
  goal: GoalConfig;
  gs: GoalState;
  actions: Record<string, number>;
  rt: Pick<SessionRuntime, 'selectorMissing' | 'missingCapabilities' | 'subtopicHits'>;
}

/** Závěrečná zpráva (WORKFLOW.md, sekce 16). */
export interface Report {
  goal_id: string;
  terminal: Terminal;
  target_topic: string;
  old_topics: string[];
  baseline: { T: number; T_ci: [number, number]; O: number } | null;
  final: { T: number; T_ci: [number, number]; O: number; phase: string } | null;
  lift: number | null;
  lift_ratio: number | null;
  old_drop: number | null;
  net_lift: number | null;
  significant: boolean;
  persisted: boolean | null;
  timeline: { cycle: number; phase?: string; T: number; O: number }[];
  effort: { cycles: number; active_minutes: number; days: number; cost_usd: number; actions: Record<string, number> };
  top_subtopics: string[];
  stop_signals: number;
  summary_cs: string;
  next_steps?: string[];
  note?: string;
}

const pp = (x: number) => `${Math.round(x * 100)} %`;
const r2 = (x: number) => Math.round(x * 100) / 100;

export function buildReport(c: ReportInput, terminal: Terminal, note: string): Report {
  const gs = c.gs;
  const ms = gs.measurements;
  const m0 = baseline(gs);
  const fin: Measurement | undefined = ms.at(-1);
  const sig = !!(m0 && fin && fin !== m0 && significant(fin, m0));
  const lift = m0 && fin ? r2(fin.T - m0.T) : null;
  const days = Math.max(1, Math.ceil((Date.now() - Date.parse(gs.started_at)) / 86_400_000));

  const report: Report = {
    goal_id: c.goal.goal_id,
    terminal,
    target_topic: c.goal.target_topic,
    old_topics: c.goal.old_topics.map((o) => o.topic),
    baseline: m0 ? { T: m0.T, T_ci: m0.T_ci, O: m0.O } : null,
    final: fin ? { T: fin.T, T_ci: fin.T_ci, O: fin.O, phase: fin.phase } : null,
    lift,
    lift_ratio: m0 && fin ? r2(fin.T / Math.max(m0.T, 0.025)) : null,
    old_drop: m0 && fin ? r2(m0.O - fin.O) : null,
    net_lift: null, // kontrolní účet zatím není
    significant: sig,
    persisted: terminal === 'SUCCESS_CONFIRMED' ? true : ms.some((m) => m.phase === 'M_persist') ? false : null,
    timeline: ms.map((m) => ({ cycle: m.cycle, ...(m.phase !== 'M' ? { phase: m.phase } : {}), T: m.T, O: m.O })),
    effort: { cycles: gs.cycle, active_minutes: Math.round(gs.active_minutes), days, cost_usd: r2(gs.cost_usd), actions: { ...c.actions } },
    top_subtopics: Object.entries(c.rt.subtopicHits).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([s]) => s),
    stop_signals: gs.cooldown_count,
    summary_cs: '',
    ...(note ? { note } : {}),
  };
  report.summary_cs = summaryCs(c, report, gs.persist_wait_until);
  if (terminal === 'PLATEAU' || terminal === 'NO_EFFECT' || terminal === 'LIMIT_REACHED') report.next_steps = nextSteps(c, report);
  return report;
}

function summaryCs(c: ReportInput, r: Report, persistSince: string | null): string {
  const topic = c.goal.target_topic;
  if (!r.baseline || !r.final) return `Cíl „${topic}“ skončil stavem ${r.terminal} bez měření.`;
  const parts = [
    `Podíl tématu „${topic}“ ve feedu: ${pp(r.baseline.T)} → ${pp(r.final.T)} (${r.lift! >= 0 ? '+' : ''}${Math.round(r.lift! * 100)} p. b.${r.lift_ratio && r.lift_ratio > 1 ? `, ${r.lift_ratio.toFixed(1).replace('.', ',')}× víc` : ''})`,
    `za ${r.effort.cycles} cyklů a ${Math.floor(r.effort.active_minutes / 60)} h ${r.effort.active_minutes % 60} min aktivního tréninku.`,
  ];
  if (r.old_topics.length) parts.push(`Staré téma (${r.old_topics.join(', ')}): ${pp(r.baseline.O)} → ${pp(r.final.O)}.`);
  if (r.terminal === 'SUCCESS_CONFIRMED' && persistSince) {
    parts.push('Změna vydržela i bez tréninku (ověřeno po pauze aspoň 12 h).');
  }
  // Neprůkazný výsledek se tak výslovně označí a nikdy se neprezentuje jako úspěch.
  if (!r.significant) parts.push('Změna není průkazná, může jít o šum.');
  parts.push(`Konečný stav: ${r.terminal}.`);
  return parts.join(' ');
}

function nextSteps(c: ReportInput, r: Report): string[] {
  const steps: string[] = [];
  const gs = c.gs;
  if (c.rt.selectorMissing >= 3) steps.push(`selector_missing ${c.rt.selectorMissing}× v poslední session, zkontrolovat UI Instagramu (npm start -- --inspect).`);
  if (c.rt.missingCapabilities.size) steps.push(`Na webu chybí: ${[...c.rt.missingCapabilities].join(', ')}. Tyto signály jdou jen z aplikace.`);
  if (gs.seed_chain_mode === 'none') steps.push('Web po startovním reelu nepokračuje navazujícími reels: startovní reels dávají jen slabý signál, víc spoléhat na hledání.');
  if (r.top_subtopics.length) steps.push(`Nejlépe fungovala podtémata ${r.top_subtopics.join(', ')}, příště začít jimi.`);
  if (!r.significant) steps.push('Zvážit jiné, užší téma, nebo ověřit, jestli Instagram započítává sledování z webu (porovnat s mobilem).');
  return steps.slice(0, 3);
}
