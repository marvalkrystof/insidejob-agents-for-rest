import { existsSync, readFileSync } from 'node:fs';

/**
 * Konfigurace cíle podle WORKFLOW.md, sekce 3. Načítá se z JSON souboru
 * (`--goal goal.json`), nebo se odvodí z GOAL v .env.
 */
export type Mode = 'fast' | 'safe';
export type BudgetAction = 'like' | 'save' | 'follow' | 'unfollow' | 'not_interested' | 'search' | 'share' | 'seed_open';

export interface Limits {
  max_cycles: number;
  max_active_minutes: number;
  max_days: number;
  max_cost_usd: number;
  hard_stop_at: string | null;
}

export interface GoalConfig {
  goal_id: string;
  target_topic: string;
  target_description: string;
  subtopics: string[];
  old_topics: { topic: string; description: string }[];
  languages: string[];
  mode: Mode;
  account_type: 'test' | 'real';
  target_alignment: number;
  min_lift: number;
  verify_persistence: boolean;
  on_success: 'maintain' | 'stop';
  limits: Limits;
  control_account_id: string | null;
  dm_share_recipient: string | null;
  seeds_enabled: boolean;
  reset_recommendations: boolean;
  active_hours: { from: string; to: string; timezone: string };
  /**
   * Odměna u TARGET_STRONG: pravděpodobnost like a uložení roste lineárně se
   * skóre od 0,8 (první číslo) do 1,0 (druhé číslo). Odchylka od WORKFLOW.md
   * sekce 7 (tam like 0,5 a save 0,2 napevno). Rozpočty ze sekce 8 platí dál.
   */
  reward: { like_p: [number, number]; save_p: [number, number] };
  /**
   * Nastavení běhu (pro spuštění z dashboardu, který předává jen --goal):
   * time_scale = jako --iterate (0,15), stop_in_minutes = jako --stop-in.
   * Volby z příkazové řádky mají přednost.
   */
  run?: { time_scale?: number; stop_in_minutes?: number };
}

export const DEFAULT_REWARD: GoalConfig['reward'] = { like_p: [0.6, 0.9], save_p: [0.3, 0.5] };

/** Pravděpodobnost akce podle skóre: od p[0] při 0,8 do p[1] při 1,0. */
export function rewardP(p: [number, number], score: number): number {
  const t = Math.min(1, Math.max(0, (score - 0.8) / 0.2));
  return p[0] + (p[1] - p[0]) * t;
}

/** Výchozí hard limity podle režimu (sekce 15.3). */
export const MODE_LIMITS: Record<Mode, Omit<Limits, 'hard_stop_at'>> = {
  fast: { max_cycles: 16, max_active_minutes: 300, max_days: 3, max_cost_usd: 10 },
  safe: { max_cycles: 10, max_active_minutes: 150, max_days: 7, max_cost_usd: 5 },
};

/** Rozpočty akcí za hodinu a za den (sekce 8). Konzervativní odhady, ne oficiální limity. */
export const BUDGETS: Record<Mode, Record<BudgetAction, { hour: number; day: number }>> = {
  fast: {
    like: { hour: 40, day: 150 }, save: { hour: 15, day: 50 }, follow: { hour: 10, day: 30 },
    unfollow: { hour: 10, day: 30 }, not_interested: { hour: 20, day: 60 }, search: { hour: 10, day: 30 },
    share: { hour: 2, day: 5 }, seed_open: { hour: 5, day: 25 },
  },
  safe: {
    like: { hour: 20, day: 60 }, save: { hour: 8, day: 25 }, follow: { hour: 4, day: 12 },
    unfollow: { hour: 5, day: 15 }, not_interested: { hour: 10, day: 30 }, search: { hour: 5, day: 15 },
    share: { hour: 0, day: 0 }, seed_open: { hour: 3, day: 10 },
  },
};
export const CYCLES_PER_DAY: Record<Mode, number> = { fast: 8, safe: 4 };

/** Pravděpodobnosti a rozsahy, které závisí na režimu (sekce 7 a 14.2). */
export const MODE_PARAMS: Record<Mode, { notInterestedP: number; seeds: [number, number] }> = {
  fast: { notInterestedP: 0.5, seeds: [3, 5] },
  safe: { notInterestedP: 0.3, seeds: [1, 3] },
};

const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

/** Odvodí cíl z jednoduchého zadání (GOAL v .env). Výchozí je skutečný účet, tedy režim safe. */
export function goalFromText(text: string, keywords: string[]): GoalConfig {
  const day = new Date().toISOString().slice(0, 10);
  return normalizeGoal({
    goal_id: `${slug(text) || 'goal'}-${day}`,
    target_topic: text,
    target_description: text,
    subtopics: keywords.length ? keywords : [text],
    account_type: 'real',
  });
}

/** Doplní výchozí hodnoty a vynutí pravidla konfigurace (sekce 3). */
export function normalizeGoal(raw: Partial<GoalConfig> & { goal_id: string; target_topic: string }): GoalConfig {
  const account_type = raw.account_type ?? 'test';
  // account_type "real" vynutí mode "safe".
  const mode: Mode = account_type === 'real' ? 'safe' : (raw.mode ?? 'fast');
  const base = MODE_LIMITS[mode];
  const l: Partial<Limits> = raw.limits ?? {};
  const pick = (v: number | null | undefined, d: number) => (v === null || v === undefined ? d : v);
  return {
    goal_id: raw.goal_id,
    target_topic: raw.target_topic,
    target_description: raw.target_description ?? raw.target_topic,
    subtopics: raw.subtopics?.length ? raw.subtopics : [raw.target_topic],
    old_topics: raw.old_topics ?? [],
    languages: raw.languages?.length ? raw.languages : ['cs', 'en'],
    mode,
    account_type,
    target_alignment: raw.target_alignment ?? 0.6,
    min_lift: raw.min_lift ?? 0.2,
    verify_persistence: raw.verify_persistence ?? true,
    on_success: raw.on_success ?? 'maintain',
    limits: {
      max_cycles: pick(l.max_cycles, base.max_cycles),
      max_active_minutes: pick(l.max_active_minutes, base.max_active_minutes),
      max_days: pick(l.max_days, base.max_days),
      max_cost_usd: pick(l.max_cost_usd, base.max_cost_usd),
      hard_stop_at: l.hard_stop_at ?? null,
    },
    control_account_id: raw.control_account_id ?? null,
    dm_share_recipient: raw.dm_share_recipient ?? null,
    seeds_enabled: raw.seeds_enabled ?? true,
    // Smí nastavit jen orchestrátor po potvrzení uživatelem; agent ho sám nikdy nezapne.
    reset_recommendations: raw.reset_recommendations ?? false,
    active_hours: raw.active_hours ?? { from: '08:00', to: '23:00', timezone: 'Europe/Prague' },
    reward: { ...DEFAULT_REWARD, ...(raw.reward ?? {}) },
    ...(raw.run ? { run: raw.run } : {}),
  };
}

export function loadGoal(path: string | undefined, fallbackText: string, keywords: string[]): GoalConfig {
  if (path) {
    if (!existsSync(path)) throw new Error(`Soubor s cílem ${path} neexistuje.`);
    return normalizeGoal(JSON.parse(readFileSync(path, 'utf8')));
  }
  return goalFromText(fallbackText, keywords);
}

/** Je teď v rámci active_hours (v časové zóně cíle)? */
export function inActiveHours(goal: GoalConfig, now = new Date()): boolean {
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: goal.active_hours.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const { from, to } = goal.active_hours;
  return from <= to ? hm >= from && hm < to : hm >= from || hm < to;
}

/** Kdy nejbližší začátek active_hours (pro PAUSE_DAY). Přesnost na minuty. */
export function nextActiveStart(goal: GoalConfig, now = new Date()): Date {
  const t = new Date(now);
  for (let i = 0; i < 48 * 60; i++) {
    t.setTime(t.getTime() + 60_000);
    if (inActiveHours(goal, t)) return t;
  }
  return t;
}
