// End-to-end test workflow (WORKFLOW.md) na lokální napodobenině Instagramu:
// M0 → F2 → F3 → F4 → F5 → PAUSE → M1 → … → FINAL_M → konečný stav → zpráva.
// Dlouhá čekání (pauzy, délky fází) jsou zrychlená, tempo reakcí na reel je skutečné.
// Spuštění: npm run test:fixture  (HEADLESS=0 = viditelné okno, VERBOSE=1 = všechny kroky)
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { launch } from '../src/browser.ts';
import { loadConfig } from '../src/config.ts';
import { normalizeGoal } from '../src/workflow/goal.ts';
import { runWorkflow } from '../src/workflow/run.ts';

if (!existsSync('test/fixture/clip-1.webm')) await import('./make-clips.ts');

process.env.HEADLESS ??= '1';
const cfg = loadConfig(['--live']);
cfg.profileDir = '.profile-test';
cfg.reelsUrl = pathToFileURL(resolve('test/fixture/reels.html')).href + '?n=200';
// Deterministicky: Judge podle klíčových slov, bez Apify.
cfg.featherlessKey = undefined;
cfg.apifyToken = undefined;

const goal = normalizeGoal({
  goal_id: 'fixture-test',
  target_topic: 'auta',
  target_description: 'auta, motorsport',
  subtopics: ['porsche', 'ferrari', 'motorsport', 'cars', 'f1', 'rallye', 'drift', 'auta'],
  old_topics: [{ topic: 'vaření', description: 'recept recipe baking pečení' }],
  account_type: 'test',
  mode: 'fast',
  verify_persistence: false,
  limits: { max_cycles: 2, max_active_minutes: 99_999, max_days: 3, max_cost_usd: 10, hard_stop_at: null },
});

for (const p of ['.profile-test', 'data-test', `logs/events-${goal.goal_id}.jsonl`]) rmSync(p, { recursive: true, force: true });

const ctx = await launch(cfg);
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page.goto(cfg.reelsUrl);
await page.waitForTimeout(1000);

const t0 = Date.now();
const r = await runWorkflow({
  page, cfg, goal,
  dataDir: 'data-test',
  exploreUrl: pathToFileURL(resolve('test/fixture/explore.html')).href,
  timeScale: 0.003, // 10 min pauza → 1,8 s, F3 15–20 min → 3–4 s
  consoleLog: process.env.VERBOSE ? 'steps' : 'quiet',
});
await ctx.close();
rmSync('.profile-test', { recursive: true, force: true });

const gs = r.goalState;
const events = readFileSync(r.eventsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Record<string, unknown>);
const steps = readFileSync(r.stepsFile!, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { node: string; event: string; msg: string });

console.log(`\nDoba testu: ${Math.round((Date.now() - t0) / 1000)} s`);
for (const m of gs.measurements) console.log(`  ${m.phase}${m.cycle}: n=${m.n} T=${m.T} [${m.T_ci.join('–')}] O=${m.O}`);
console.log(`Konečný stav: ${gs.terminal}  (${gs.terminal_note})`);
console.log(`Zpráva: ${(gs.report as { summary_cs?: string })?.summary_cs}`);

const fails: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) fails.push(msg); };

// Cyklus a konečný stav
check(gs.terminal === 'LIMIT_REACHED', `konečný stav ${gs.terminal}, čekal jsem LIMIT_REACHED (max_cycles 2, bez průkazného zlepšení)`);
check(gs.cycle === 2, `dokončené cykly ${gs.cycle}, čekal jsem 2`);
check(gs.measurements.map((m) => `${m.phase}${m.cycle}`).join(',') === 'M0,M1,M_final2', `měření ${gs.measurements.map((m) => `${m.phase}${m.cycle}`)}, čekal jsem M0,M1,M_final2`);
check(gs.measurements.every((m) => m.n === 40), `měření nemají 40 položek: ${gs.measurements.map((m) => m.n)}`);
check(gs.measurements.every((m) => m.T > 0.2 && m.T < 0.8), 'T mimo očekávaný rozsah (testovací feed je zhruba půl na půl)');
check(gs.status === 'done' && !!gs.report, 'chybí zpráva nebo stav done');
const report = gs.report as { summary_cs?: string; next_steps?: string[] } | null;
check(/není průkazná/.test(report?.summary_cs ?? ''), 'neprůkazný výsledek není ve zprávě označený');
check(Array.isArray(report?.next_steps), 'LIMIT_REACHED musí mít next_steps');

// Události (sekce 12)
const kinds = new Set(events.map((e) => e.event));
for (const k of ['goal_start', 'reel', 'measurement', 'check', 'cycle_summary', 'terminal']) check(kinds.has(k), `v logu událostí chybí "${k}"`);
const reels = events.filter((e) => e.event === 'reel');
const sources = new Set(reels.map((e) => e.source));
for (const s of ['measure', 'feed', 'explore']) check(sources.has(s), `žádný reel se source "${s}"`);
check(reels.filter((e) => e.source === 'measure').every((e) => (e.actions as string[]).join() === 'measure'), 'při měření M byla interakce');
check(reels.filter((e) => (e.actions as string[]).includes('like')).every((e) => e.category === 'TARGET_STRONG'), 'like mimo TARGET_STRONG');
check(reels.filter((e) => e.category === 'NEUTRAL').every((e) => (e.watch_s as number) <= 4.5), 'NEUTRAL sledován déle než 1–2 s (+ režie)');
check(events.filter((e) => e.event === 'cycle_summary').length === 2, 'čekal jsem 2× cycle_summary');
check(events.filter((e) => e.event === 'cycle_summary').at(-1)?.next === 'FINAL_M', 'poslední F5 nevedlo na FINAL_M');

// Kroky grafu
for (const n of ['start', 'measure', 'check', 'f2', 'f3', 'f4', 'f5', 'pause', 'finalM', 'report']) {
  check(steps.some((s) => s.node === n && s.event === 'exit'), `uzel ${n} neproběhl`);
}
check(!steps.some((s) => s.event === 'error'), `chyba v krocích: ${steps.filter((s) => s.event === 'error').map((s) => s.msg).join('; ')}`);

if (fails.length) {
  console.error(`\n✗ ${fails.length} chyb:\n  - ${fails.join('\n  - ')}`);
  process.exit(1);
}
console.log(`\n✓ Workflow prošel celý cyklus až po konečný stav (${steps.length} kroků v logu, ${reels.length} reels).`);
