import * as ig from '../instagram.ts';
import { pause } from '../human.ts';
import { HardLimitHit, SessionEnd, StopSignal, type Ctx } from './context.ts';
import { inActiveHours } from './goal.ts';

/**
 * Pojistky volané mezi akcemi: varování Instagramu (sekce 11), viditelnost
 * karty, hard limity (sekce 15.3), Ctrl+C.
 */
export async function safety(c: Ctx): Promise<void> {
  if (c.signal?.aborted) throw new SessionEnd('přerušeno uživatelem (Ctrl+C)');
  const page = c.page;
  // Testovací stránka (file://) nemá session ani varování Instagramu.
  if (c.cfg.reelsUrl.startsWith('file:')) return;
  if (await ig.isActionBlocked(page)) {
    // isActionBlocked pozná i /challenge/; rozlišíme ověření od omezení aktivity.
    if (/\/challenge\//.test(page.url())) throw new StopSignal('verification', 'Instagram chce ověření (challenge)');
    throw new StopSignal('action_blocked', 'Instagram omezil aktivitu');
  }
  if (/\/accounts\/login|\/auth_platform\/|\/two_factor|captcha/.test(page.url()) || !(await ig.hasSession(page))) {
    throw new StopSignal('verification', 'výzva k přihlášení / ověření / CAPTCHA');
  }
  await waitVisible(c);
}

/** Karta musí být vidět (video se jinak zastaví). Po 5 minutách bez viditelnosti konec session. */
async function waitVisible(c: Ctx): Promise<void> {
  const visible = () => c.page.evaluate(() => document.visibilityState === 'visible').catch(() => true);
  if (await visible()) return;
  c.log.warn('safety', 'karta není vidět, čekám (žádné akce)');
  const until = Date.now() + 5 * 60_000;
  while (Date.now() < until) {
    await pause(2000, 0.2);
    if (await visible()) return;
  }
  throw new SessionEnd('karta nebyla 5 minut vidět');
}

/** Odhad délky měření M (20 dlaždic + 20 reels): podle ostrých běhů 2,5–3,5 min. */
export const FINAL_M_MEASURE_MS = 4 * 60_000;

/** Kontrola hard limitů. Volat po každém reelu a mezi kroky fází. */
export function hardLimit(c: Ctx): string | null {
  const gs = c.store.goal();
  const l = c.goal.limits;
  // Skutečné minuty aktivní práce (i v zrychleném režimu, ať limity sedí s realitou).
  const activeMin = gs.active_minutes + (c.rt.activeSince ? (Date.now() - c.rt.activeSince) / 60_000 : 0);
  // Trénink končí tak, aby se před hard_stop_at stihlo FINAL_M (pauza 30 min × zrychlení + ~4 min měření).
  if (l.hard_stop_at && Date.now() >= Date.parse(l.hard_stop_at) - c.scale(30 * 60_000) - FINAL_M_MEASURE_MS) return 'hard_stop_at';
  // gs.cycle = počet dokončených cyklů F2–F4 (zvyšuje se na konci F4).
  if (gs.cycle >= l.max_cycles + gs.extra_cycles) return 'max_cycles';
  if (activeMin >= l.max_active_minutes) return 'max_active_minutes';
  if (Date.now() - Date.parse(gs.started_at) >= l.max_days * 86_400_000) return 'max_days';
  if (gs.cost_usd >= l.max_cost_usd) return 'max_cost_usd';
  return null;
}

export function assertNoHardLimit(c: Ctx): void {
  const hit = hardLimit(c);
  if (hit) throw new HardLimitHit(hit);
}

/** Mimo active_hours se nepracuje (pravidlo 6). */
export const activeNow = (c: Ctx) => c.cfg.reelsUrl.startsWith('file:') || inActiveHours(c.goal);

/** Prvek nenalezen (sekce 11): počítá selector_missing, 5× za session → konec session. */
export function selectorMissing(c: Ctx, what: string): void {
  c.rt.selectorMissing++;
  c.events.write('selector_missing', { what, count: c.rt.selectorMissing });
  c.log.warn('safety', `selector_missing: ${what} (${c.rt.selectorMissing}/5)`);
  if (c.rt.selectorMissing >= 5) {
    c.notify('5× selector_missing v jedné session, pravděpodobně se změnilo UI Instagramu.');
    throw new SessionEnd('selector_missing 5× (změna UI?)');
  }
}

/** Fáze F1–F4 se počítají do max_active_minutes. */
export function startActive(c: Ctx): void { if (!c.rt.activeSince) c.rt.activeSince = Date.now(); }
export function stopActive(c: Ctx): void {
  if (!c.rt.activeSince) return;
  const gs = c.store.goal();
  const ms = Date.now() - c.rt.activeSince;
  gs.active_minutes = Math.round((gs.active_minutes + ms / 60_000) * 100) / 100;
  c.rt.activeSince = null;
  c.store.save();
}
