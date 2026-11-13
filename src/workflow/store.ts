import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUDGETS, CYCLES_PER_DAY, type BudgetAction, type GoalConfig } from './goal.ts';

/**
 * Trvalý stav účtu a cílů (WORKFLOW.md, sekce 10). Ukládá se do JSON po
 * každé akci, která mění sledování nebo rozpočty, a na konci každé fáze.
 */
export type Terminal =
  | 'ABORTED' | 'SUCCESS_CONFIRMED' | 'SUCCESS' | 'PLATEAU' | 'NO_EFFECT' | 'LIMIT_REACHED' | 'CANCELLED';

export type MeasurePhase = 'M' | 'M_persist' | 'M_final';

export interface MeasureItem {
  kind: 'explore' | 'reel';
  id: string;
  author: string;
  caption: string;
  target_score: number;
  old_topic_score: number;
  subtopic: string;
  /** Soubor se snímkem v adresáři měření (pro přehodnocení při změně Judge). */
  shot?: string;
}

export interface Measurement {
  ts: string;
  cycle: number;
  phase: MeasurePhase;
  judge_version: string;
  n: number;
  T: number;
  T_ci: [number, number];
  T_feed: number | null;
  T_explore: number | null;
  O: number;
  items_ref: string;
  /** Měření z režimu MAINTAIN (nepočítá se do stagnace). */
  maintain?: boolean;
  /** Verze Judge, se kterou bylo měření původně ohodnocené (když bylo přehodnoceno). */
  rescored_from?: string;
}

export interface GoalState {
  status: 'active' | 'persist_wait' | 'maintaining' | 'done' | 'archived';
  target_topic: string;
  followed_by_agent: string[];
  unfollowed_by_agent: string[];
  creator_strong_count: Record<string, number>;
  used_queries: { query: string; ts: string }[];
  used_seeds: string[];
  /** Kdy a od koho byl startovní reel otevřen (pravidlo 14.3: stejný autor max. 1× denně). */
  seed_history: { reel_id: string; author: string; ts: string }[];
  seed_chain_mode: 'unknown' | 'chain' | 'none';
  measurements: Measurement[];
  cycle: number;
  started_at: string;
  active_minutes: number;
  cost_usd: number;
  cooldown_count: number;
  stagnation_count: number;
  expansions: number;
  /** Cyklus, ve kterém proběhlo poslední rozšíření podtémat (pro pravidlo F5 č. 4). */
  last_expansion_cycle: number | null;
  success_streak: number;
  /** Kolikrát už M_PERSIST nevyšlo (po druhém nezdaru → PLATEAU). */
  persist_failures: number;
  persist_wait_until: string | null;
  /** Pod target − 0,1 v MAINTAIN (2× po sobě → zpět do běžných cyklů). */
  maintain_low_streak: number;
  /** Navýšení max_cycles po návratu z MAINTAIN (+4 cykly). */
  extra_cycles: number;
  /** Rozšířená podtémata od Discovery / plánovače. */
  extra_subtopics: string[];
  terminal: Terminal | null;
  terminal_note: string | null;
  report: unknown | null;
}

export interface Budgets {
  day: string;
  used: Record<BudgetAction, number>;
  used_this_hour: { hour: string } & Partial<Record<BudgetAction, number>>;
  cycles_today: number;
}

export interface PersistentState {
  account_id: string;
  cooldown_until: string | null;
  active_goal_id: string | null;
  last_activity_at: string | null;
  goals: Record<string, GoalState>;
  budgets: Budgets;
}

const zeroUsed = (): Record<BudgetAction, number> =>
  ({ like: 0, save: 0, follow: 0, unfollow: 0, not_interested: 0, search: 0, share: 0, seed_open: 0 });

export function newGoalState(goal: GoalConfig, now = new Date()): GoalState {
  return {
    status: 'active',
    target_topic: goal.target_topic,
    followed_by_agent: [],
    unfollowed_by_agent: [],
    creator_strong_count: {},
    used_queries: [],
    used_seeds: [],
    seed_history: [],
    seed_chain_mode: 'unknown',
    measurements: [],
    cycle: 0,
    started_at: now.toISOString(),
    active_minutes: 0,
    cost_usd: 0,
    cooldown_count: 0,
    stagnation_count: 0,
    expansions: 0,
    last_expansion_cycle: null,
    success_streak: 0,
    persist_failures: 0,
    persist_wait_until: null,
    maintain_low_streak: 0,
    extra_cycles: 0,
    extra_subtopics: [],
    terminal: null,
    terminal_note: null,
    report: null,
  };
}

export class Store {
  state: PersistentState;
  readonly file: string;
  constructor(file: string, accountId = 'default') {
    this.file = file;
    this.state = existsSync(file)
      ? (JSON.parse(readFileSync(file, 'utf8')) as PersistentState)
      : {
          account_id: accountId,
          cooldown_until: null,
          active_goal_id: null,
          last_activity_at: null,
          goals: {},
          budgets: { day: today(), used: zeroUsed(), used_this_hour: { hour: hourNow() }, cycles_today: 0 },
        };
  }

  /** Atomický zápis (přes dočasný soubor), ať se stav při pádu nerozbije. */
  save(): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2));
    renameSync(tmp, this.file);
  }

  goal(id = this.state.active_goal_id): GoalState {
    if (!id || !this.state.goals[id]) throw new Error(`Cíl ${id} ve stavu neexistuje.`);
    return this.state.goals[id];
  }

  touch(): void { this.state.last_activity_at = new Date().toISOString(); }

  /** Rozpočty se nulují s novým dnem a hodinou. */
  private rollover(): void {
    const b = this.state.budgets;
    if (b.day !== today()) { b.day = today(); b.used = zeroUsed(); b.cycles_today = 0; }
    if (b.used_this_hour.hour !== hourNow()) b.used_this_hour = { hour: hourNow() };
  }

  /** Dovolí rozpočet akci? Na novém účtu (první 3 dny) mají follow a unfollow poloviční limit. */
  canSpend(action: BudgetAction, goal: GoalConfig, newAccount = false): boolean {
    this.rollover();
    const lim = BUDGETS[goal.mode][action];
    const factor = newAccount && (action === 'follow' || action === 'unfollow') ? 0.5 : 1;
    const b = this.state.budgets;
    return (b.used_this_hour[action] ?? 0) < Math.floor(lim.hour * factor) && b.used[action] < Math.floor(lim.day * factor);
  }

  spend(action: BudgetAction): void {
    this.rollover();
    const b = this.state.budgets;
    b.used[action]++;
    b.used_this_hour[action] = (b.used_this_hour[action] ?? 0) + 1;
    this.save();
  }

  cyclesLeftToday(goal: GoalConfig): number {
    this.rollover();
    return CYCLES_PER_DAY[goal.mode] - this.state.budgets.cycles_today;
  }

  addCost(usd: number, goalId = this.state.active_goal_id): void {
    if (!goalId || !usd) return;
    this.goal(goalId).cost_usd = Math.round((this.goal(goalId).cost_usd + usd) * 1e6) / 1e6;
  }
}

/** Datum a hodina v místním čase (rozpočty se počítají podle dne uživatele). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function hourNow(): string { return String(new Date().getHours()).padStart(2, '0'); }
