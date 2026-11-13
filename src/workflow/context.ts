import type { Page } from 'patchright';
import type { Config } from '../config.ts';
import type { AgentLog } from '../log.ts';
import type { Discovery } from './discovery.ts';
import type { EventLog } from './events.ts';
import type { GoalConfig } from './goal.ts';
import type { Judge } from './judge.ts';
import type { Store } from './store.ts';

/**
 * Signály, které přeruší jakoukoli fázi (WORKFLOW.md, "Platí z jakéhokoli
 * stavu"). Vyhazují se jako výjimky a obal uzlu je převede na přechod v grafu.
 */
export type StopKind = 'action_blocked' | 'verification' | 'silent_block';

/** Varování od Instagramu (sekce 11) → STOP, cooldown, při druhém ABORTED. */
export class StopSignal extends Error {
  readonly kind: StopKind;
  constructor(kind: StopKind, detail: string) { super(detail); this.kind = kind; }
}

/** Došel hard limit (sekce 15.3) → dokončit reel → FINAL_M. */
export class HardLimitHit extends Error {
  readonly limit: string;
  constructor(limit: string) { super(`hard limit: ${limit}`); this.limit = limit; }
}

/** Session se musí ukončit bez STOP (selector_missing 5×, neviditelná karta, Ctrl+C). */
export class SessionEnd extends Error {}

/** Co se pamatuje jen po dobu jedné session (ne v trvalém stavu). */
export interface SessionRuntime {
  startedAt: number;
  selectorMissing: number;
  /** Akce, které neprošly po sobě (like se vrátil zpět) → 2× = tichá blokace. */
  failedActionsInRow: number;
  queriesThisSession: string[];
  /** Fáze F1–F4 běží → čas se přičítá do active_minutes. */
  activeSince: number | null;
  /** Schopnosti, které web nemá (např. „Nemám zájem“ na desktopových Reels). */
  missingCapabilities: Set<string>;
  /** Reels aktuálního cyklu (pro feed_alignment, seed_chain_alignment). */
  cycleReels: { source: string; target_score: number; old_topic_score: number; subtopic: string; hashtags: string[] }[];
  /** Kolikrát bylo podtéma TARGET_STRONG v této session (pro top_subtopics ve zprávě). */
  subtopicHits: Record<string, number>;
  /** Horké měření Explore z F4 (jen pro log). */
  exploreHot: { alignment: number | null; old: number | null };
}

export interface Ctx {
  page: Page;
  cfg: Config;
  goal: GoalConfig;
  store: Store;
  judge: Judge;
  discovery: Discovery;
  log: AgentLog;
  events: EventLog;
  rt: SessionRuntime;
  /** Zrychlení dlouhých čekání (pauzy mezi cykly, délky fází) pro testy. 1 = skutečný čas. */
  scale: (ms: number) => number;
  signal?: AbortSignal;
  /** URL Explore (na testovací stránce lokální soubor). */
  exploreUrl: string;
  /** Upozornění uživatele (sekce 4: notify_user). */
  notify: (msg: string) => void;
}

export function newRuntime(): SessionRuntime {
  return { startedAt: Date.now(), selectorMissing: 0, failedActionsInRow: 0, queriesThisSession: [], activeSince: null, missingCapabilities: new Set(), cycleReels: [], subtopicHits: {}, exploreHot: { alignment: null, old: null } };
}
