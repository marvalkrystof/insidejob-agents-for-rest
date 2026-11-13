import { launch } from './browser.ts';
import { loadConfig } from './config.ts';
import { pause } from './human.ts';
import * as ig from './instagram.ts';
import { loadGoal } from './workflow/goal.ts';
import { runWorkflow } from './workflow/run.ts';

const cfg = loadConfig();

console.log(`Cíl feedu: „${cfg.goal}“`);
console.log(`Klíčová slova: ${cfg.keywords.join(', ')}`);
console.log(`Klasifikace: ${cfg.featherlessKey ? `Featherless (${cfg.textModel})` : 'jen klíčová slova (chybí FEATHERLESS_API_KEY)'}`);
console.log(`Discovery (startovní reels): ${cfg.apifyToken ? 'Apify' : 'vypnuté (chybí APIFY_TOKEN)'}`);
console.log(`Prohlížeč: ${cfg.channel}, profil ${cfg.profileDir}`);
console.log(cfg.dryRun
  ? 'Režim: DRY RUN, jen kouká a přeskakuje (pro akce spusť s --live)'
  : 'Režim: LIVE, lajkuje, sleduje, vyhledává');

const ctx = await launch(cfg);
const page = ctx.pages()[0] ?? (await ctx.newPage());

const abort = new AbortController();
process.once('SIGINT', () => {
  console.log('\nUkončuji… (Ctrl+C znovu = okamžitě)');
  abort.abort();
  process.once('SIGINT', () => process.exit(130));
});

try {
  await page.goto(cfg.reelsUrl, { waitUntil: 'domcontentloaded' });
  await pause(2500);

  await ensureLoggedIn();
  if (cfg.inspect) await inspect();
  else await runGraph();
} finally {
  await ctx.close();
}

async function runGraph() {
  let goal = loadGoal(cfg.goalFile, cfg.goal, cfg.keywords);
  // Nastavení běhu ze souboru cíle (dashboard předává jen --goal); příkazová řádka má přednost.
  if (cfg.timeScale === 1 && goal.run?.time_scale) cfg.timeScale = goal.run.time_scale;
  if (!cfg.stopInMinutes && goal.run?.stop_in_minutes) cfg.stopInMinutes = goal.run.stop_in_minutes;
  if (cfg.stopInMinutes) {
    // Rezerva 1 min, ať se stihne dokončit reel a zapsat zprávu.
    goal = { ...goal, limits: { ...goal.limits, hard_stop_at: new Date(Date.now() + (cfg.stopInMinutes - 1) * 60_000).toISOString() } };
  }
  console.log(`Cíl: ${goal.goal_id} („${goal.target_topic}“), režim ${goal.mode}, účet ${goal.account_type}`);
  console.log(`Limity: ${goal.limits.max_cycles} cyklů, ${goal.limits.max_active_minutes} min, ${goal.limits.max_days} dny, $${goal.limits.max_cost_usd}${goal.limits.hard_stop_at ? `, stop v ${goal.limits.hard_stop_at}` : ''}\n`);

  if (cfg.timeScale !== 1) console.log(`Rychlé iterování: dlouhá čekání × ${cfg.timeScale} (F3 ${Math.round(15 * cfg.timeScale * 10) / 10}–${Math.round(20 * cfg.timeScale * 10) / 10} min, pauza ${Math.round(10 * cfg.timeScale * 10) / 10}–${Math.round(30 * cfg.timeScale * 10) / 10} min)\n`);
  const r = await runWorkflow({ page, cfg, goal, signal: abort.signal, timeScale: cfg.timeScale });
  const gs = r.goalState;
  console.log(`\nKonec session: ${String(r.final.sessionEnd || '–')}`);
  console.log(`Stav cíle: ${gs.status}${gs.terminal ? `, konečný stav ${gs.terminal}` : ''}, dokončené cykly ${gs.cycle}, měření ${gs.measurements.length}`);
  for (const m of gs.measurements) console.log(`  ${m.phase}${m.cycle}: T=${Math.round(m.T * 100)} % [${Math.round(m.T_ci[0] * 100)}–${Math.round(m.T_ci[1] * 100)} %], O=${Math.round(m.O * 100)} %`);
  if (gs.report) console.log(`\n${(gs.report as { summary_cs: string }).summary_cs}`);
  console.log(`\nKroky: ${r.stepsFile}\nUdálosti: ${r.eventsFile}\nStav: ${r.store.file}`);
}

/**
 * Před session se přihlásí člověk (heslo, captcha, 2FA v okně). Během
 * session je výzva k přihlášení STOP (WORKFLOW.md, sekce 11): agent nic nezadává.
 */
async function ensureLoggedIn() {
  if (cfg.reelsUrl.startsWith('file:')) return;
  if (!ig.onInstagram(page)) {
    console.log('👉 Okno není na Instagramu. Potvrď případné upozornění sítě, čekám až 10 minut.');
    const until = Date.now() + 10 * 60_000;
    while (!ig.onInstagram(page) && Date.now() < until) await pause(1500);
  }
  if (!(await ig.isLoggedIn(page))) {
    console.log('👉 Nejsi přihlášený. V okně prohlížeče jsem otevřel přihlášení do Instagramu.\n');
    await ig.loginFlow(page, cfg.reelsUrl);
  }
  await ig.dismissDialogs(page);
}

/** Diagnostika selektorů: najde aktuální reel a vypíše, co v něm vidí. */
async function inspect() {
  for (let i = 0; i < 3; i++) {
    const reel = await ig.readActiveReel(page);
    console.log(`\n=== reel ${i + 1} ===`);
    console.log(JSON.stringify({ reel, url: page.url(), dom: reel ? await ig.describeActive(page) : null }, null, 2));
    if (reel) console.log('posun na další reel:', (await ig.nextReel(page, reel)) ? 'OK' : 'NEPOVEDL SE');
    await pause(1500);
  }
}
