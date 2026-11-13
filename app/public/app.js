// Panel Feed Trainer: ovládání běhu a živé grafy z dat, která posílá app/server.ts (SSE).
// Bez knihoven: grafy jsou ručně kreslené SVG, všechny texty z dat přes textContent.

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NBSP = ' ';
const pct = (v) => (v === null || v === undefined || Number.isNaN(v) ? '–' : `${Math.round(v * 100)}${NBSP}%`);
const pp = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(Math.round(v * 100))}${NBSP}pp`;
const hhmmss = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
const hhmm = (ts) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'numeric' }); };
const ago = (ms) => {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
};
const dur = (ms) => {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const TARGET_HIT = 0.5;
const OLD_HIT = 0.6;

const CAT = {
  TARGET_STRONG: { label: 'Strong match', cls: 'c-strong', css: '--s1' },
  TARGET_WEAK: { label: 'Weak match', cls: 'c-weak', css: '--s1-weak' },
  NEUTRAL: { label: 'Other content', cls: 'c-neutral', css: '--neutral' },
  OLD_TOPIC: { label: 'Old topic', cls: 'c-old', css: '--s2' },
};
const CAT_ORDER = ['TARGET_STRONG', 'TARGET_WEAK', 'NEUTRAL', 'OLD_TOPIC'];
const SOURCES = {
  measure: 'Measurement', feed: 'Feed', search: 'Search', seed: 'Seed reel', seed_chain: 'After seed',
  explore: 'Explore', profile: 'Profile',
};
const ACTIONS = {
  like: 'Like', save: 'Save', follow: 'Follow', unfollow: 'Unfollow',
  not_interested: 'Not interested', search: 'Search', share: 'Share', seed_open: 'Seed reels',
};
const ACT_SHORT = {
  watch_full: 'watched', rewatch: '2×', like: 'like', save: 'saved', follow: 'follow', skip: 'skipped',
  not_interested: 'not interested', measure: 'measure', open_audio: 'audio', share: 'shared',
};
const TERMINAL = {
  SUCCESS: { tone: 'good', label: 'Goal reached' },
  SUCCESS_CONFIRMED: { tone: 'good', label: 'Goal reached and the change lasted' },
  PLATEAU: { tone: 'warn', label: 'Feed moved, but stopped improving' },
  NO_EFFECT: { tone: 'bad', label: 'No significant effect' },
  LIMIT_REACHED: { tone: 'warn', label: 'Limit reached' },
  ABORTED: { tone: 'bad', label: 'Aborted after an Instagram warning' },
  CANCELLED: { tone: 'warn', label: 'Goal cancelled' },
};
const STEPS = [
  ['M', 'Measure'], ['CHECK', 'Check'], ['F1', 'Cleanup'], ['F2', 'Search'],
  ['F3', 'Reels'], ['F4', 'Explore'], ['F5', 'Plan'], ['PAUSE', 'Pause'],
];
const EXTRA_STEPS = { FINAL: 'Final measurement', REPORT: 'Report', STOP: 'Stop', MAINTAIN: 'Maintain', PAUSE_DAY: 'Pause until tomorrow', PERSIST: 'Waiting to verify', START: 'Start' };
const NODE_STEP = {
  start: 'START', measure: 'M', check: 'CHECK', f1: 'F1', f2: 'F2', f3: 'F3', f4: 'F4', f5: 'F5',
  pause: 'PAUSE', pauseDay: 'PAUSE_DAY', persistWait: 'PERSIST', finalM: 'FINAL', report: 'REPORT', stop: 'STOP', maintain: 'MAINTAIN',
};

const S = {
  goalId: new URLSearchParams(location.search).get('goal') || null,
  goals: [],
  config: null,
  budgets: null,
  events: [],
  state: null,
  steps: [],
  proc: null,
  out: [],
  defaults: null,
  tab: 'existing',
  lastReelCount: 0,
  measHover: null,
};

// ───────────────────────────── téma ─────────────────────────────

function applyTheme(t) {
  if (t) document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
try { applyTheme(localStorage.getItem('ft-theme')); } catch { /* bez úložiště */ }
$('themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next);
  try { localStorage.setItem('ft-theme', next); } catch { /* bez úložiště */ }
  render();
});

// ───────────────────────────── spojení ─────────────────────────────

let es = null;
function connect() {
  es?.close();
  const q = S.goalId ? `?goal=${encodeURIComponent(S.goalId)}` : '';
  es = new EventSource(`/api/stream${q}`);
  const on = (type, fn) => es.addEventListener(type, (e) => { fn(JSON.parse(e.data)); schedule(); });
  es.onopen = () => { $('conn').className = 'conn ok'; $('conn').title = 'Connected, data is live'; };
  es.onerror = () => { $('conn').className = 'conn bad'; $('conn').title = 'Connection lost, retrying…'; };
  on('snapshot', (d) => {
    S.goalId = d.goal_id; S.goals = d.goals; S.config = d.config; S.budgets = d.budgets; S.cyclesPerDay = d.cycles_per_day;
    S.events = d.events; S.state = d.state; S.steps = d.steps; S.proc = d.proc; S.out = d.out;
    S.lastReelCount = reels().length;
    if (S.goalId) history.replaceState(null, '', `?goal=${encodeURIComponent(S.goalId)}`);
    renderOut(true);
  });
  on('events', (d) => { S.events.push(...d.lines); });
  on('reset', () => { S.events = []; S.lastReelCount = 0; });
  on('steps', (d) => { S.steps.push(...d.lines); if (S.steps.length > 800) S.steps.splice(0, S.steps.length - 800); });
  on('steps_reset', (d) => { S.steps = d.lines ?? []; });
  on('state', (d) => { S.state = d; });
  on('proc', (d) => { S.proc = d; });
  on('goals', (d) => { S.goals = d.goals; });
  on('out', (d) => { S.out.push(d.line); if (S.out.length > 500) S.out.shift(); renderOut(false); });
}

function setGoal(id) {
  if (id === S.goalId) return;
  S.goalId = id;
  S.events = []; S.state = null; S.config = null;
  connect();
}

let pending = false;
function schedule() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; render(); });
}

// ───────────────────────────── odvozená data ─────────────────────────────

const reels = () => S.events.filter((e) => e.event === 'reel');
function category(r) {
  if (r.category && r.source !== 'measure') return r.category;
  const t = Number(r.target_score ?? 0), o = Number(r.old_topic_score ?? 0);
  if (t >= 0.8) return 'TARGET_STRONG';
  if (o >= OLD_HIT) return 'OLD_TOPIC';
  if (t >= TARGET_HIT) return 'TARGET_WEAK';
  return 'NEUTRAL';
}
function measurements() {
  const fromState = S.state?.goal?.measurements;
  const fromEvents = S.events.filter((e) => e.event === 'measurement');
  return (fromEvents.length >= (fromState?.length ?? 0) ? fromEvents : fromState) ?? [];
}
const checks = () => S.events.filter((e) => e.event === 'check');
function measLabel(m) {
  if (m.phase === 'M_final') return `Final ${m.cycle}`;
  if (m.phase === 'M_persist') return `Persist ${m.cycle}`;
  return `M${m.cycle}`;
}
/** Klouzavý feed_alignment přes reels ze zdroje "feed" (sekce 13.1). */
function rolling(window = 20) {
  const feed = reels().filter((r) => r.source === 'feed');
  const out = [];
  for (let i = 0; i < feed.length; i++) {
    const win = feed.slice(Math.max(0, i - window + 1), i + 1);
    out.push({ i, r: feed[i], v: win.filter((x) => Number(x.target_score) >= TARGET_HIT).length / win.length, n: win.length });
  }
  return out;
}

// ───────────────────────────── vykreslení ─────────────────────────────

function render() {
  renderGoals();
  renderStatus();
  renderBanner();
  renderTiles();
  renderStepper();
  renderMeasChart();
  renderLive();
  renderSources();
  renderBudgets();
  renderJudge();
  renderAlerts();
  renderReelTable();
}

function renderGoals() {
  const sel = $('goalSelect');
  const key = JSON.stringify(S.goals.map((g) => [g.goal_id, g.status, g.terminal])) + S.goalId;
  if (sel.dataset.key !== key) {
    sel.dataset.key = key;
    sel.replaceChildren(...S.goals.map((g) => {
      const o = new Option(`${g.target_topic} · ${g.goal_id}${g.terminal ? ` · ${g.terminal}` : g.status ? ` · ${g.status}` : ''}`, g.goal_id);
      o.selected = g.goal_id === S.goalId;
      return o;
    }));
    if (!S.goals.length) sel.append(new Option('No goal yet', ''));
  }
  const fsel = $('goalFileSelect');
  const withFile = S.goals.filter((g) => g.file && g.goal_id !== 'fixture-test');
  const fkey = JSON.stringify(withFile.map((g) => g.goal_id));
  if (fsel.dataset.key !== fkey) {
    const prev = S.pickFile || fsel.value || S.goalId;
    fsel.dataset.key = fkey;
    fsel.replaceChildren(...withFile.map((g) => new Option(`${g.target_topic} (${g.file})`, g.goal_id)));
    if (withFile.some((g) => g.goal_id === prev)) { fsel.value = prev; if (prev === S.pickFile) S.pickFile = null; }
    if (!withFile.length) fsel.append(new Option('No file in goals/', ''));
  }
  // Výběr pro Start drží zobrazený cíl (horní výběr), ať Start spustí to, co vidíš.
  if (!S.pickFile && S.goalId && withFile.some((x) => x.goal_id === S.goalId) && fsel.value !== S.goalId) fsel.value = S.goalId;
  const g = withFile.find((x) => x.goal_id === fsel.value);
  $('goalFileInfo').textContent = g ? `Status: ${g.terminal ?? g.status ?? 'new'} · last activity ${g.last_activity ? hhmm(g.last_activity) : '–'}` : '';
}

function renderStatus() {
  const p = S.proc;
  const pill = $('statusPill');
  const start = $('startBtn'), stop = $('stopBtn');
  if (!p) return;
  $('keyFeather').classList.toggle('on', !!p.has_featherless);
  $('keyApify').classList.toggle('on', !!p.has_apify);
  if (p.running) {
    pill.className = `pill ${p.stopping ? 'stop' : 'run'}`;
    pill.textContent = p.stopping ? 'Stopping…' : p.kind === 'fixture' ? 'Test running' : p.live ? 'Running (full)' : 'Running (watch only)';
    $('statusSince').textContent = p.started_at ? `${dur(Date.now() - p.started_at)}` : '';
    $('statusText').textContent = `Goal ${p.goal_id}. ${p.stopping ? 'The agent is finishing its action and saving state. Click again to stop it immediately.' : 'Do not close the Instagram browser window; it can stay in the background.'}`;
    start.disabled = true;
    stop.disabled = false;
    stop.textContent = p.stopping ? 'Stop now' : 'Stop';
  } else if (p.external) {
    const goals = p.external_goals ?? [];
    pill.className = 'pill ext';
    pill.textContent = 'Running from terminal';
    $('statusSince').textContent = p.external_since ? `last step ${ago(p.external_since)}` : '';
    $('statusText').textContent = `${goals.length > 1 ? 'Sessions' : 'Session'} ${goals.join(', ')} ${goals.length > 1 ? 'are' : 'is'} running outside the app. The panel follows live (pick the goal at the top); stop it in the terminal (Ctrl+C).${p.external_blocking ? '' : ' A test on the local copy does not block starting the agent.'}`;
    start.disabled = S.tab === 'fixture' ? goals.includes('fixture-test') : !!p.external_blocking;
    stop.disabled = true;
    stop.textContent = 'Stop';
  } else {
    pill.className = 'pill';
    pill.textContent = 'Not running';
    $('statusSince').textContent = p.exit ? `ended ${hhmm(p.exit.at)}` : '';
    $('statusText').textContent = p.exit ? `The last run ended ${p.exit.signal ? `with signal ${p.exit.signal}` : `with code ${p.exit.code}`}.` : 'Pick a goal and start training.';
    start.disabled = false;
    stop.disabled = true;
    stop.textContent = 'Stop';
  }
  $('runModeCard').hidden = S.tab === 'fixture';
  const live = document.querySelector('input[name="runmode"]:checked')?.value === 'live';
  const realAccount = S.tab === 'new'
    ? document.querySelector('input[name="account_type"]:checked')?.value === 'real'
    : S.config?.account_type === 'real';
  $('liveWarn').hidden = !(live && realAccount && S.tab !== 'fixture');
}

function renderBanner() {
  const b = $('banner');
  const gs = S.state?.goal;
  const term = gs?.terminal ?? [...S.events].reverse().find((e) => e.event === 'terminal')?.terminal;
  const cooldown = S.state?.cooldown_until && Date.parse(S.state.cooldown_until) > Date.now() ? S.state.cooldown_until : null;
  let tone = null, title = '', text = '', list = [];
  if (term) {
    const t = TERMINAL[term] ?? { tone: 'info', label: term };
    tone = t.tone;
    title = `${t.label} (${term})`;
    text = gs?.report?.summary_cs ?? gs?.terminal_note ?? '';
    list = gs?.report?.next_steps ?? [];
  } else if (cooldown) {
    tone = 'bad';
    title = 'Instagram restricted actions';
    text = `The agent is paused until ${hhmm(cooldown)}. Do not start anything before then.`;
  } else if (gs?.status === 'persist_wait' && gs.persist_wait_until) {
    tone = 'info';
    title = 'Waiting to verify that the change lasts';
    text = `The next measurement can start from ${hhmm(gs.persist_wait_until)}.`;
  }
  if (!tone) { b.hidden = true; return; }
  b.hidden = false;
  b.className = `banner ${tone}`;
  const ico = document.createElement('span');
  ico.className = 'ico';
  ico.textContent = tone === 'good' ? '✓' : tone === 'bad' ? '!' : tone === 'warn' ? '!' : 'i';
  const body = document.createElement('div');
  const h = document.createElement('b');
  h.textContent = title;
  const p = document.createElement('div');
  p.textContent = text;
  body.append(h, p);
  if (list.length) {
    const ul = document.createElement('ul');
    ul.className = 'small';
    for (const s of list) { const li = document.createElement('li'); li.textContent = s; ul.append(li); }
    body.append(ul);
  }
  b.replaceChildren(ico, body);
}

function setMeter(id, used, max) {
  const el = $(id);
  const r = max > 0 ? Math.min(1, used / max) : 0;
  el.style.width = `${r * 100}%`;
  el.className = r >= 1 ? 'bad' : r >= 0.8 ? 'warn' : '';
}

function renderTiles() {
  const ms = measurements();
  const m0 = ms.find((m) => m.phase === 'M' && m.cycle === 0) ?? ms[0];
  const last = ms.at(-1);
  const topic = S.config?.target_topic ?? S.state?.goal?.target_topic ?? '';
  $('heroLabel').textContent = topic ? `Share of “${topic}” (official measurement)` : 'Topic share in feed';
  $('heroValue').textContent = last ? pct(last.T) : '–';
  const hd = $('heroDelta');
  hd.replaceChildren();
  if (last && m0 && last !== m0) {
    const lift = last.T - m0.T;
    const sig = last.T_ci[0] > m0.T_ci[1];
    const d = document.createElement('span');
    d.className = lift > 0 ? 'up' : lift < 0 ? 'down' : '';
    d.textContent = pp(lift);
    const badge = document.createElement('span');
    badge.className = `badge ${sig ? 'good' : 'warn'}`;
    badge.textContent = sig ? 'significant' : 'not significant yet';
    hd.append(d, ` vs. baseline ${pct(m0.T)} `, badge);
  } else if (last) {
    hd.textContent = `baseline measurement, interval ${pct(last.T_ci[0])}–${pct(last.T_ci[1])}`;
  } else hd.textContent = 'waiting for the first measurement';

  const roll = rolling();
  const lr = roll.at(-1);
  $('tLive').textContent = lr ? pct(lr.v) : '–';
  $('tLiveSub').textContent = lr ? `${roll.length} feed reels in total` : 'no feed reels yet';

  $('tOld').textContent = last ? pct(last.O) : '–';
  const hasOld = (S.config?.old_topics?.length ?? 0) > 0;
  $('tOldSub').textContent = last && m0 && last !== m0 ? `baseline ${pct(m0.O)}` : hasOld ? S.config.old_topics.map((o) => o.topic).join(', ') : 'not set';

  const gs = S.state?.goal;
  const lim = S.config?.limits;
  $('tCycles').textContent = gs ? String(gs.cycle) : '–';
  $('tCyclesSub').textContent = lim ? `limit ${lim.max_cycles}` : '';
  setMeter('mCycles', gs?.cycle ?? 0, lim?.max_cycles ?? 0);
  const mins = Math.round(gs?.active_minutes ?? 0);
  $('tMinutes').textContent = gs ? `${mins}${NBSP}min` : '–';
  $('tMinutesSub').textContent = lim ? `limit ${lim.max_active_minutes}${NBSP}min` : '';
  setMeter('mMinutes', mins, lim?.max_active_minutes ?? 0);
  $('tCost').textContent = gs ? `$${nf2.format(gs.cost_usd ?? 0)}` : '–';
  $('tCostSub').textContent = lim ? `limit $${nf.format(lim.max_cost_usd)}` : '';
  setMeter('mCost', gs?.cost_usd ?? 0, lim?.max_cost_usd ?? 0);
}

function renderStepper() {
  const enters = S.steps.filter((s) => s.event === 'enter' && NODE_STEP[s.node]);
  const lastEnter = enters.at(-1);
  let active = lastEnter ? NODE_STEP[lastEnter.node] : null;
  // Měření hned po finalM je závěrečné měření (M_final).
  if (active === 'M' && enters.at(-2)?.node === 'finalM') active = 'FINAL';
  const live = S.proc?.running || S.proc?.external;
  const ol = $('stepper');
  const items = [...STEPS];
  if (active && !STEPS.some(([k]) => k === active)) items.push([active, EXTRA_STEPS[active] ?? active]);
  const idx = items.findIndex(([k]) => k === active);
  ol.replaceChildren(...items.map(([k, label], i) => {
    const li = document.createElement('li');
    const b = document.createElement('b');
    b.textContent = k === 'PAUSE_DAY' || k === 'PERSIST' || k === 'START' ? '' : k.replace('CHECK', '✓').replace('PAUSE', '⏸').replace('FINAL', 'Mf').replace('REPORT', '≡').replace('STOP', '■').replace('MAINTAIN', '↻');
    li.append(b, label);
    if (live && i === idx) li.className = 'active';
    else if (live && idx > 0 && i < idx && STEPS.some(([x]) => x === k)) li.className = 'done';
    return li;
  }));
  const lastMsg = [...S.steps].reverse().find((s) => s.msg && s.event !== 'enter');
  const nowT = $('nowText');
  if (lastMsg) {
    nowT.textContent = `${lastMsg.node}: ${lastMsg.msg}`;
    $('nowWhen').textContent = `${live ? '' : 'last entry '}${ago(Date.parse(lastMsg.ts))}`;
  } else {
    nowT.textContent = live ? 'Waiting for the first step…' : 'The agent is not running.';
    $('nowWhen').textContent = '';
  }
}

// ── SVG pomocníci ──

function svgEl(tag, attrs = {}, parent) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.append(e);
  return e;
}
function svgText(parent, x, y, text, attrs = {}) {
  const t = svgEl('text', { x, y, ...attrs }, parent);
  t.textContent = text;
  return t;
}
function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

const tip = $('tooltip');
function showTip(evt, title, rows) {
  const box = document.createElement('div');
  const t = document.createElement('div');
  t.className = 'tt-title';
  t.textContent = title;
  box.append(t);
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tt-row';
    const key = document.createElement('i');
    key.style.background = r.color ?? 'transparent';
    const v = document.createElement('b');
    v.textContent = r.value;
    const l = document.createElement('span');
    l.textContent = r.label;
    row.append(key, v, l);
    box.append(row);
  }
  tip.replaceChildren(...box.childNodes);
  tip.hidden = false;
  const pad = 14;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = evt.clientX + pad, y = evt.clientY + pad;
  if (x + w > innerWidth - 8) x = evt.clientX - w - pad;
  if (y + h > innerHeight - 8) y = evt.clientY - h - pad;
  tip.style.left = `${Math.max(8, x)}px`;
  tip.style.top = `${Math.max(8, y)}px`;
}
const hideTip = () => { tip.hidden = true; };

function yAxis(svg, m, plotW, y) {
  for (const v of [0, 0.25, 0.5, 0.75, 1]) {
    svgEl('line', { x1: m.l, x2: m.l + plotW, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }, svg);
    svgText(svg, m.l - 6, y(v) + 4, `${v * 100}${NBSP}%`, { 'text-anchor': 'end' });
  }
}
/** Referenční čára; popisek vlevo nad čarou, ať pravý okraj patří popiskům sérií. */
function refLine(svg, m, plotW, yv, label) {
  svgEl('line', { x1: m.l, x2: m.l + plotW, y1: yv, y2: yv, class: 'ref' }, svg);
  const below = yv - m.t < 14;
  svgText(svg, m.l + 6, below ? yv + 13 : yv - 5, label);
}

// ── oficiální měření ──

function renderMeasChart() {
  const box = $('measChart');
  const ms = measurements();
  const m0 = ms.find((m) => m.phase === 'M' && m.cycle === 0) ?? ms[0];
  const target = S.config?.target_alignment ?? 0.6;
  const hasOld = ms.some((m) => m.O > 0) || (S.config?.old_topics?.length ?? 0) > 0;

  const leg = $('measLegend');
  const legItems = [['line', '--s1', `Topic (${S.config?.target_topic ?? 'goal'})`], ['band', null, '95% interval']];
  if (hasOld) legItems.push(['line', '--s2', 'Old topic']);
  legItems.push(['ref', null, 'target and significance threshold']);
  leg.replaceChildren(...legItems.map(([k, v, t]) => {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.className = k;
    if (v) i.style.background = `var(${v})`;
    s.append(i, t);
    return s;
  }));

  renderMeasTable(ms, m0);
  if (!ms.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'No measurement yet. The first one (M0) runs at the start of training after 10 minutes of inactivity.';
    box.replaceChildren(d);
    return;
  }

  const W = Math.max(300, box.clientWidth), H = 260;
  const m = { l: 44, r: W < 520 ? 64 : 96, t: 14, b: 28 };
  // Stejné označení (např. dvě M0 po restartu session) rozlišit časem.
  const labels = ms.map(measLabel);
  const dup = labels.map((l) => labels.filter((x) => x === l).length > 1);
  const xLabel = (q, i) => (dup[i] ? `${labels[i]} ${new Date(q.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : labels[i]);
  const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
  const n = ms.length;
  const x = (i) => m.l + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const y = (v) => m.t + (1 - Math.max(0, Math.min(1, v))) * plotH;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Official measurements: ${ms.map((q) => `${measLabel(q)} ${pct(q.T)}`).join(', ')}` });

  yAxis(svg, m, plotW, y);
  refLine(svg, m, plotW, y(target), `target ${pct(target)}`);
  if (m0) {
    const u0 = m0.T_ci[1];
    if (Math.abs(y(u0) - y(target)) > 12) refLine(svg, m, plotW, y(u0), `threshold ${pct(u0)}`);
  }

  // interval jako pás + svislé úsečky
  if (n > 1) {
    const top = ms.map((q, i) => `${x(i)},${y(q.T_ci[1])}`).join(' ');
    const bot = ms.map((q, i) => `${x(i)},${y(q.T_ci[0])}`).reverse().join(' ');
    svgEl('polygon', { points: `${top} ${bot}`, class: 'band' }, svg);
  }
  ms.forEach((q, i) => svgEl('line', { x1: x(i), x2: x(i), y1: y(q.T_ci[0]), y2: y(q.T_ci[1]), class: 'ci' }, svg));

  if (hasOld && n > 1) svgEl('polyline', { points: ms.map((q, i) => `${x(i)},${y(q.O)}`).join(' '), class: 'line s2' }, svg);
  if (n > 1) svgEl('polyline', { points: ms.map((q, i) => `${x(i)},${y(q.T)}`).join(' '), class: 'line s1' }, svg);
  if (hasOld) ms.forEach((q, i) => svgEl('circle', { cx: x(i), cy: y(q.O), r: 4, class: 'dot2' }, svg));
  ms.forEach((q, i) => svgEl('circle', { cx: x(i), cy: y(q.T), r: 4.5, class: 'dot1' }, svg));

  // osa x
  const step = Math.ceil(n / Math.max(1, Math.floor(plotW / 64)));
  ms.forEach((q, i) => { if (i % step === 0 || i === n - 1) svgText(svg, x(i), H - 8, xLabel(q, i), { 'text-anchor': 'middle' }); });

  // popisky na konci (jen když se nepřekrývají)
  const last = ms[n - 1];
  const yT = y(last.T), yO = y(last.O);
  if (!hasOld || Math.abs(yT - yO) >= 16) {
    svgText(svg, x(n - 1) + 10, yT + 4, `Topic ${pct(last.T)}`, { class: 'lbl-strong' });
    if (hasOld) svgText(svg, x(n - 1) + 10, yO + 4, `Old ${pct(last.O)}`, { class: 'lbl' });
  }

  // hover: zaměřovač na nejbližší měření
  const cross = svgEl('line', { y1: m.t, y2: m.t + plotH, class: 'cross', visibility: 'hidden' }, svg);
  const hit = svgEl('rect', { x: m.l - 10, y: m.t, width: plotW + 20, height: plotH, class: 'hit', tabindex: 0 }, svg);
  const showAt = (i, evt) => {
    const q = ms[i];
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    const rows = [{ color: cssVar('--s1'), value: pct(q.T), label: `topic (interval ${pct(q.T_ci[0])}–${pct(q.T_ci[1])})` }];
    if (hasOld) rows.push({ color: cssVar('--s2'), value: pct(q.O), label: 'old topic' });
    if (m0 && q !== m0) {
      rows.push({ value: pp(q.T - m0.T), label: 'oproti M0' });
      rows.push({ value: q.T_ci[0] > m0.T_ci[1] ? 'yes' : 'no', label: 'significant improvement' });
    }
    if (q.T_feed !== null && q.T_feed !== undefined) rows.push({ value: `${pct(q.T_feed)} / ${pct(q.T_explore)}`, label: 'reels / Explore' });
    showTip(evt, `${labels[i]} · ${hhmm(q.ts)} · ${q.n} items`, rows);
  };
  const nearest = (evt) => {
    const r = svg.getBoundingClientRect();
    const px = ((evt.clientX - r.left) / r.width) * W;
    let best = 0;
    ms.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    return best;
  };
  hit.addEventListener('pointermove', (e) => showAt(nearest(e), e));
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  hit.addEventListener('focus', () => { const r = hit.getBoundingClientRect(); showAt(n - 1, { clientX: r.right - 40, clientY: r.top + 20 }); });
  hit.addEventListener('blur', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
  box.replaceChildren(svg);
}

function renderMeasTable(ms, m0) {
  const wrap = $('measTable');
  const t = document.createElement('table');
  const head = document.createElement('tr');
  for (const h of ['Measurement', 'Time', 'Topic', 'Interval', 'Old topic', 'vs. M0', 'Significant']) {
    const th = document.createElement('th'); th.textContent = h; head.append(th);
  }
  const thead = document.createElement('thead'); thead.append(head);
  const tb = document.createElement('tbody');
  for (const q of ms) {
    const tr = document.createElement('tr');
    const cells = [measLabel(q), hhmm(q.ts), pct(q.T), `${pct(q.T_ci[0])}–${pct(q.T_ci[1])}`, pct(q.O),
      m0 && q !== m0 ? pp(q.T - m0.T) : '–', m0 && q !== m0 ? (q.T_ci[0] > m0.T_ci[1] ? 'ano' : 'ne') : '–'];
    for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.append(td); }
    tb.append(tr);
  }
  t.append(thead, tb);
  wrap.replaceChildren(t);
}
document.querySelectorAll('[data-table]').forEach((b) => b.addEventListener('click', () => {
  const el = $(b.dataset.table);
  el.hidden = !el.hidden;
  b.textContent = el.hidden ? 'Table' : 'Hide table';
}));

// ── živý feed ──

function renderLive() {
  const box = $('liveChart');
  const roll = rolling();
  const ms = measurements();
  const m0 = ms.find((q) => q.phase === 'M' && q.cycle === 0);
  const target = S.config?.target_alignment ?? 0.6;
  if (!roll.length) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = 'No feed reels yet. They appear in phase F3 (scrolling Reels).';
    box.replaceChildren(d);
  } else {
    const W = Math.max(300, box.clientWidth), H = 200;
    const m = { l: 44, r: W < 520 ? 52 : 64, t: 14, b: 26 };
    const plotW = W - m.l - m.r, plotH = H - m.t - m.b;
    const n = roll.length;
    const x = (i) => m.l + (n === 1 ? 0 : (i * plotW) / (n - 1));
    const y = (v) => m.t + (1 - v) * plotH;
    const last = roll[n - 1];
    const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Rolling on-topic share: now ${pct(last.v)} of the last ${last.n} feed reels` });
    yAxis(svg, m, plotW, y);
    refLine(svg, m, plotW, y(target), `target ${pct(target)}`);
    if (m0 && Math.abs(y(m0.T) - y(target)) > 12) refLine(svg, m, plotW, y(m0.T), `baseline ${pct(m0.T)}`);

    // hranice cyklů
    let prevCycle = null;
    roll.forEach((p, i) => {
      const c = p.r.cycle;
      if (prevCycle !== null && c !== prevCycle) {
        svgEl('line', { x1: x(i), x2: x(i), y1: m.t, y2: m.t + plotH, class: 'grid' }, svg);
        svgText(svg, x(i) + 4, m.t + 10, `cycle ${c}`);
      }
      prevCycle = c;
    });

    const pts = roll.map((p, i) => `${x(i)},${y(p.v)}`);
    if (n > 1) {
      svgEl('polygon', { points: `${x(0)},${y(0)} ${pts.join(' ')} ${x(n - 1)},${y(0)}`, class: 'band' }, svg);
      svgEl('polyline', { points: pts.join(' '), class: 'line s1' }, svg);
    }
    svgEl('circle', { cx: x(n - 1), cy: y(last.v), r: 4.5, class: 'dot1' }, svg);
    svgText(svg, x(n - 1) + 10, y(last.v) + 4, pct(last.v), { class: 'lbl-strong' });

    const xStep = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
    for (let i = 0; i < n; i += xStep) svgText(svg, x(i), H - 8, `#${i + 1}`, { 'text-anchor': 'middle' });

    const cross = svgEl('line', { y1: m.t, y2: m.t + plotH, class: 'cross', visibility: 'hidden' }, svg);
    const hit = svgEl('rect', { x: m.l - 10, y: m.t, width: plotW + 20, height: plotH, class: 'hit' }, svg);
    hit.addEventListener('pointermove', (e) => {
      const r = svg.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / plotW) * (n - 1))));
      const p = roll[i];
      cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
      const c = category(p.r);
      showTip(e, `Feed reel #${i + 1} · ${hhmmss(p.r.ts)} · cycle ${p.r.cycle}`, [
        { color: cssVar('--s1'), value: pct(p.v), label: `on topic (last ${p.n})` },
        { color: cssVar(CAT[c].css), value: CAT[c].label, label: `@${p.r.author ?? '?'}` },
        { value: nf.format(Number(p.r.target_score ?? 0)), label: 'topic score' },
      ]);
    });
    hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); hideTip(); });
    box.replaceChildren(svg);
  }

  // pruh všech zhlédnutých reels
  const all = reels();
  const shown = all.slice(-320);
  const counts = Object.fromEntries(CAT_ORDER.map((k) => [k, 0]));
  for (const r of all) counts[category(r)]++;
  $('stripLegend').replaceChildren(...CAT_ORDER.map((k) => {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.className = `box ${CAT[k].cls}`;
    s.append(i, `${CAT[k].label} ${counts[k]}`);
    return s;
  }));
  const strip = $('strip');
  strip.setAttribute('aria-label', `Watched reels: ${CAT_ORDER.map((k) => `${CAT[k].label} ${counts[k]}`).join(', ')}`);
  strip.replaceChildren(...shown.map((r) => {
    const s = document.createElement('span');
    const c = category(r);
    s.className = CAT[c].cls;
    s.addEventListener('pointerenter', (e) => showTip(e, `${hhmmss(r.ts)} · ${r.phase ?? ''} · ${SOURCES[r.source] ?? r.source}`, [
      { color: cssVar(CAT[c].css), value: CAT[c].label, label: `@${r.author ?? '?'}` },
      { value: nf.format(Number(r.target_score ?? 0)), label: 'topic score' },
      { value: `${nf.format(Number(r.watch_s ?? 0))} s`, label: (r.actions ?? []).map((a) => ACT_SHORT[a] ?? a).join(', ') || 'no action' },
    ]));
    s.addEventListener('pointermove', (e) => { tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, e.clientX + 14)}px`; tip.style.top = `${Math.min(innerHeight - tip.offsetHeight - 8, e.clientY + 14)}px`; });
    s.addEventListener('pointerleave', hideTip);
    return s;
  }));
}

// ── zdroje ──

function renderSources() {
  const all = reels();
  const by = {};
  for (const r of all) {
    const src = r.source ?? 'feed';
    by[src] ??= Object.fromEntries(CAT_ORDER.map((k) => [k, 0]));
    by[src][category(r)]++;
  }
  const rows = Object.entries(by).sort((a, b) => Object.keys(SOURCES).indexOf(a[0]) - Object.keys(SOURCES).indexOf(b[0]));
  const max = Math.max(1, ...rows.map(([, c]) => CAT_ORDER.reduce((s, k) => s + c[k], 0)));
  $('srcLegend').replaceChildren(...CAT_ORDER.map((k) => {
    const s = document.createElement('span');
    const i = document.createElement('i');
    i.className = `box ${CAT[k].cls}`;
    s.append(i, CAT[k].label);
    return s;
  }));
  const box = $('srcBars');
  if (!rows.length) {
    const d = document.createElement('div'); d.className = 'empty muted small'; d.textContent = 'No reels yet.';
    box.replaceChildren(d);
    return;
  }
  box.replaceChildren(...rows.map(([src, c]) => {
    const total = CAT_ORDER.reduce((s, k) => s + c[k], 0);
    const row = document.createElement('div');
    row.className = 'hbar';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = SOURCES[src] ?? src;
    const track = document.createElement('div'); track.className = 'track';
    track.style.width = `${(total / max) * 100}%`;
    for (const k of CAT_ORDER) {
      if (!c[k]) continue;
      const seg = document.createElement('span');
      seg.className = CAT[k].cls;
      seg.style.flex = `${c[k]} 0 0`;
      seg.addEventListener('pointermove', (e) => showTip(e, SOURCES[src] ?? src, [{ color: cssVar(CAT[k].css), value: `${c[k]} (${pct(c[k] / total)})`, label: CAT[k].label }]));
      seg.addEventListener('pointerleave', hideTip);
      track.append(seg);
    }
    const num = document.createElement('span'); num.className = 'num'; num.textContent = String(total);
    row.append(name, track, num);
    return row;
  }));
}

// ── rozpočty ──

function renderBudgets() {
  const box = $('budgets');
  const b = S.state?.budgets;
  const caps = S.budgets;
  $('budgetMode').textContent = S.config ? `${S.config.mode === 'fast' ? 'fast' : 'safe'} mode${b?.day ? ` · ${b.day}` : ''}` : '';
  if (!caps) { box.replaceChildren(); return; }
  const today = new Date().toISOString().slice(0, 10);
  const used = b && b.day === today ? b.used ?? {} : {};
  const hour = b && b.day === today ? b.used_this_hour ?? {} : {};
  const rows = Object.entries(caps).filter(([, c]) => c.day > 0);
  const cyc = document.createElement('div');
  cyc.className = 'mrow';
  const cycName = document.createElement('span'); cycName.className = 'name'; cycName.textContent = 'Cycles today';
  const cycMeter = document.createElement('div'); cycMeter.className = 'meter';
  const cycFill = document.createElement('span');
  const cUsed = b && b.day === today ? b.cycles_today ?? 0 : 0;
  const cMax = S.cyclesPerDay ?? 0;
  cycFill.style.width = `${cMax ? Math.min(100, (cUsed / cMax) * 100) : 0}%`;
  cycFill.className = cMax && cUsed >= cMax ? 'bad' : cMax && cUsed / cMax >= 0.8 ? 'warn' : '';
  cycMeter.append(cycFill);
  const cycNum = document.createElement('span'); cycNum.className = 'num'; cycNum.textContent = `${cUsed} / ${cMax}`;
  cyc.append(cycName, cycMeter, cycNum);
  box.replaceChildren(cyc, ...rows.map(([a, c]) => {
    const u = used[a] ?? 0;
    const h = Number(hour[a] ?? 0);
    const row = document.createElement('div');
    row.className = 'mrow';
    row.title = `This hour ${h} / ${c.hour}`;
    const name = document.createElement('span'); name.className = 'name'; name.textContent = ACTIONS[a] ?? a;
    const meter = document.createElement('div'); meter.className = 'meter';
    const fill = document.createElement('span');
    const r = Math.min(1, u / c.day);
    fill.style.width = `${r * 100}%`;
    fill.className = r >= 1 ? 'bad' : r >= 0.8 || h >= c.hour ? 'warn' : '';
    meter.append(fill);
    const num = document.createElement('span'); num.className = 'num'; num.textContent = `${u} / ${c.day}`;
    row.append(name, meter, num);
    return row;
  }));
}

// ── Judge ──

function renderJudge() {
  const box = $('judge');
  const rs = reels().filter((r) => r.judge);
  const count = {};
  for (const r of rs) count[r.judge] = (count[r.judge] ?? 0) + 1;
  const total = rs.length;
  const version = [...S.events].reverse().find((e) => e.judge_version)?.judge_version ?? '–';
  const kids = [];
  if (total) {
    const order = ['text', 'prefetch', 'vision', 'keyword', 'timeout', 'error'];
    const names = { text: 'From text', prefetch: 'From text (ahead)', vision: 'With screenshot', keyword: 'Keywords', timeout: 'Too slow (→ Other content)', error: 'Error' };
    const keys = [...new Set([...order.filter((k) => count[k]), ...Object.keys(count)])];
    const rows = document.createElement('div');
    rows.className = 'meters';
    for (const k of keys) {
      const row = document.createElement('div'); row.className = 'mrow';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = names[k] ?? k;
      const meter = document.createElement('div'); meter.className = 'meter';
      const fill = document.createElement('span');
      fill.style.width = `${(count[k] / total) * 100}%`;
      if (k === 'timeout' || k === 'error') fill.className = count[k] / total > 0.2 ? 'bad' : 'warn';
      meter.append(fill);
      const num = document.createElement('span'); num.className = 'num'; num.textContent = `${count[k]} (${pct(count[k] / total)})`;
      row.append(name, meter, num);
      rows.append(row);
    }
    kids.push(rows);
    const bad = ((count.timeout ?? 0) + (count.error ?? 0)) / total;
    if (bad > 0.2) {
      const w = document.createElement('p');
      w.className = 'warn small';
      w.textContent = `Classification did not answer in time for ${pct(bad)} of reels, so they counted as “other content”. The feed may look worse than it is and the agent gives no likes. Check the model speed or the latency limit.`;
      kids.push(w);
    }
  } else {
    const d = document.createElement('p'); d.className = 'muted small'; d.textContent = 'No classified reels yet.';
    kids.push(d);
  }
  const dl = document.createElement('dl'); dl.className = 'kv';
  for (const [k, v] of [['Version', version], ['Classified', String(total)]]) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    dl.append(dt, dd);
  }
  kids.push(dl);
  box.replaceChildren(...kids);
}

// ── upozornění ──

function renderAlerts() {
  const items = [];
  for (const e of S.events) {
    let tone = 'info', text = '';
    switch (e.event) {
      case 'goal_start': text = `Goal “${e.target_topic}” started, ${e.mode === 'fast' ? 'fast' : 'safe'} mode.`; break;
      case 'notify': tone = 'warn'; text = e.msg; break;
      case 'stop': tone = 'bad'; text = `STOP: ${e.reason}${e.detail ? ` (${e.detail})` : ''}. Paused until ${hhmm(e.cooldown_until)}.`; break;
      case 'error': tone = 'bad'; text = `Error in ${e.node}: ${e.message}`; break;
      case 'session_end': tone = 'warn'; text = `Session ended: ${e.reason}`; break;
      case 'selector_missing': tone = 'warn'; text = `Element not found on the page: ${e.what} (${e.count}×)`; break;
      case 'capability_missing': text = `The web app lacks “${e.capability}”: ${e.why}`; break;
      case 'terminal': tone = (TERMINAL[e.terminal]?.tone ?? 'info'); text = `Final state ${e.terminal}.`; break;
      case 'persist_wait': text = `Waiting to verify until ${hhmm(e.until)}.`; break;
      case 'cycle_summary': tone = 'good'; text = `Cycle ${e.cycle} done: feed ${pct(e.feed_alignment)}, Explore ${pct(e.explore_alignment)}. Next: ${e.next}${e.reason ? ` (${e.reason})` : ''}.`; break;
      case 'measurement': text = `Measurement ${measLabel(e)}: topic ${pct(e.T)} (${pct(e.T_ci[0])}–${pct(e.T_ci[1])}), old ${pct(e.O)}.`; break;
      default: continue;
    }
    items.push({ ts: e.ts, tone, text });
  }
  const ul = $('alerts');
  if (!items.length) {
    const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Nothing yet.';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...items.slice(-60).reverse().map((it) => {
    const li = document.createElement('li');
    li.className = it.tone;
    const ico = document.createElement('span'); ico.className = 'ico';
    ico.textContent = it.tone === 'good' ? '✓' : it.tone === 'info' ? 'i' : '!';
    const body = document.createElement('div');
    const time = document.createElement('time'); time.textContent = hhmm(it.ts);
    const t = document.createElement('div'); t.textContent = it.text;
    body.append(time, t);
    li.append(ico, body);
    return li;
  }));
}

// ── tabulka reels ──

function renderReelTable() {
  const all = reels();
  $('reelCount').textContent = `${all.length} celkem`;
  const fresh = all.length - S.lastReelCount;
  S.lastReelCount = all.length;
  const tb = $('reelTable').tBodies[0];
  const rows = all.slice(-150).reverse();
  tb.replaceChildren(...rows.map((r, i) => {
    const tr = document.createElement('tr');
    if (i < fresh && fresh < 20) tr.className = 'fresh';
    const c = category(r);
    const cells = [
      hhmmss(r.ts), `${r.phase ?? ''}${r.cycle !== undefined ? ` · c${r.cycle}` : ''}`, SOURCES[r.source] ?? r.source ?? '',
      `@${r.author ?? '?'}`, null, nf.format(Number(r.target_score ?? 0)), nf.format(Number(r.old_topic_score ?? 0)),
      `${nf.format(Number(r.watch_s ?? 0))} s`, (r.actions ?? []).map((a) => ACT_SHORT[a] ?? a).join(', '),
    ];
    cells.forEach((v, j) => {
      const td = document.createElement('td');
      if (j === 3) td.className = 'author';
      if (j >= 5 && j <= 7) td.className = 'num';
      if (v === null) {
        const span = document.createElement('span'); span.className = 'cat';
        const k = document.createElement('i'); k.className = CAT[c].cls;
        span.append(k, CAT[c].label);
        td.append(span);
      } else td.textContent = v;
      tr.append(td);
    });
    return tr;
  }));
}

function renderOut(full) {
  const pre = $('out');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 20;
  if (full) pre.textContent = S.out.join('\n');
  else pre.textContent = S.out.join('\n');
  if (atBottom || full) pre.scrollTop = pre.scrollHeight;
}

// ───────────────────────────── ovládání ─────────────────────────────

function selectTab(t) {
  S.tab = t;
  for (const [id, name] of [['tabExisting', 'existing'], ['tabNew', 'new'], ['tabFixture', 'fixture']]) $(id).setAttribute('aria-selected', String(name === t));
  $('paneExisting').hidden = t !== 'existing';
  $('paneNew').hidden = t !== 'new';
  $('paneFixture').hidden = t !== 'fixture';
  renderStatus();
}
$('tabExisting').addEventListener('click', () => selectTab('existing'));
$('tabNew').addEventListener('click', () => selectTab('new'));
$('tabFixture').addEventListener('click', () => selectTab('fixture'));

$('goalSelect').addEventListener('change', (e) => { if (e.target.value) setGoal(e.target.value); });
$('goalFileSelect').addEventListener('change', (e) => { if (e.target.value) setGoal(e.target.value); renderGoals(); });
document.querySelectorAll('input[name="runmode"]').forEach((r) => r.addEventListener('change', renderStatus));

function syncModeFields() {
  const form = $('paneNew');
  const real = form.account_type.value === 'real';
  const fast = form.querySelector('input[name="mode"][value="fast"]');
  fast.disabled = real;
  if (real) form.querySelector('input[name="mode"][value="safe"]').checked = true;
  $('modeNote').textContent = real ? 'A real account always uses the safe pace and lower limits.' : 'Fast pace only on a test account.';
  const lim = S.defaults?.modes?.[form.mode.value];
  if (lim) {
    form.max_cycles.placeholder = String(lim.max_cycles);
    form.max_active_minutes.placeholder = String(lim.max_active_minutes);
    form.max_cost_usd.placeholder = String(lim.max_cost_usd);
  }
  renderStatus();
}
$('paneNew').addEventListener('change', syncModeFields);
fetch('/api/goal-defaults').then((r) => r.json()).then((d) => { S.defaults = d; syncModeFields(); }).catch(() => {});

// ── přirozený popis → job definition ──

/** ISO čas → hodnota pro <input type="datetime-local"> v místním čase. */
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Sestaví cíl z formuláře; pole, která formulář nemá, převezme z posledního návrhu kompilátoru. */
function goalFromForm() {
  const form = $('paneNew');
  const goal = Object.fromEntries(new FormData(form).entries());
  goal.verify_persistence = form.verify_persistence.checked;
  goal.seeds_enabled = form.seeds_enabled.checked;
  const d = S.draft?.goal;
  if (d) {
    goal.languages = d.languages;
    goal.target_alignment = d.target_alignment;
    goal.on_success = d.on_success;
    goal.active_hours = d.active_hours;
    goal.max_days = d.limits?.max_days;
    goal.old_topics_detail = d.old_topics;
    goal.source_query = S.draft.query;
  }
  return goal;
}

function renderDraftJson() {
  const box = $('draftJsonBox');
  if (!S.draft) { box.hidden = true; return; }
  box.hidden = false;
  const g = goalFromForm();
  const csv = (v) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const olds = csv(g.old_topics).map((t) => ({ topic: t, description: (g.old_topics_detail ?? []).find((o) => o.topic.toLowerCase() === t.toLowerCase())?.description || t }));
  const num = (v) => (v === '' || v === undefined || v === null ? null : Number(v));
  const view = {
    target_topic: g.target_topic, target_description: g.target_description, subtopics: csv(g.subtopics), old_topics: olds,
    languages: g.languages, account_type: g.account_type, mode: g.account_type === 'real' ? 'safe' : g.mode,
    target_alignment: g.target_alignment, verify_persistence: g.verify_persistence, on_success: g.on_success, seeds_enabled: g.seeds_enabled,
    limits: { max_cycles: num(g.max_cycles), max_active_minutes: num(g.max_active_minutes), max_days: num(g.max_days), max_cost_usd: num(g.max_cost_usd), hard_stop_at: g.hard_stop_at ? new Date(g.hard_stop_at).toISOString() : null },
    active_hours: g.active_hours,
  };
  $('draftJson').textContent = JSON.stringify(view, null, 2);
}
$('paneNew').addEventListener('input', () => { if (S.draft) renderDraftJson(); });
$('paneNew').addEventListener('change', () => { if (S.draft) renderDraftJson(); });

function fillForm(r) {
  const form = $('paneNew');
  const g = r.goal;
  const set = (name, value) => {
    const el = form.elements[name];
    if (!el) return;
    el.value = value ?? '';
    const f = el.closest('.field');
    if (f) { f.classList.add('filled'); setTimeout(() => f.classList.remove('filled'), 1600); }
  };
  set('target_topic', g.target_topic);
  set('target_description', g.target_description);
  set('subtopics', (g.subtopics ?? []).join(', '));
  set('old_topics', (g.old_topics ?? []).map((o) => o.topic).join(', '));
  form.querySelector(`input[name="account_type"][value="${g.account_type}"]`).checked = true;
  form.querySelector(`input[name="mode"][value="${g.mode}"]`).checked = true;
  set('max_cycles', g.limits.max_cycles);
  set('max_active_minutes', g.limits.max_active_minutes);
  set('max_cost_usd', g.limits.max_cost_usd);
  set('hard_stop_at', toLocalInput(g.limits.hard_stop_at));
  form.verify_persistence.checked = !!g.verify_persistence;
  form.seeds_enabled.checked = g.seeds_enabled !== false;
  if (g.limits.hard_stop_at || g.verify_persistence || g.seeds_enabled === false) form.querySelector('details.limits').open = true;
  const rm = document.querySelector(`input[name="runmode"][value="${r.run_mode === 'live' ? 'live' : 'dry'}"]`);
  if (rm) rm.checked = true;
  syncModeFields();
}

function renderNlResult(r) {
  const box = $('nlResult');
  const block = (title, items, cls) => {
    if (!items?.length) return null;
    const div = document.createElement('div');
    if (cls) div.className = cls;
    const h = document.createElement('h3'); h.textContent = title;
    const ul = document.createElement('ul');
    for (const it of items) { const li = document.createElement('li'); li.textContent = it; ul.append(li); }
    div.append(h, ul);
    return div;
  };
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = `${r.model} · ${nf.format(r.ms / 1000)} s · ${r.run_mode === 'live' ? 'Full' : 'Watch only'}`;
  box.replaceChildren(...[
    block('Filled in by the model', r.assumptions),
    block('Please clarify', r.questions, 'q'),
    block('Heads up', r.warnings, 'w'),
    meta,
  ].filter(Boolean));
  box.hidden = false;
}

async function compileNl() {
  const text = $('nlText').value.trim();
  const btn = $('nlBtn'), st = $('nlStatus');
  showError('');
  if (text.length < 3) { st.textContent = 'Write at least a few words.'; return; }
  btn.disabled = true; btn.classList.add('loading');
  st.textContent = 'The model is building the goal…';
  const t0 = Date.now();
  const tick = setInterval(() => { st.textContent = `The model is building the goal… ${Math.round((Date.now() - t0) / 1000)} s`; }, 1000);
  try {
    const r = await post('/api/compile', { text });
    S.draft = { ...r, query: text };
    fillForm(r);
    renderNlResult(r);
    renderDraftJson();
    st.textContent = 'Done. Check the form and start, or edit the description and build again.';
  } catch (err) {
    st.textContent = '';
    showError(err.message);
  } finally {
    clearInterval(tick);
    btn.disabled = false; btn.classList.remove('loading');
  }
}
$('nlBtn').addEventListener('click', compileNl);
$('nlText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); compileNl(); } });

$('saveGoalBtn').addEventListener('click', async () => {
  showError('');
  const form = $('paneNew');
  if (!form.reportValidity()) return;
  try {
    const r = await post('/api/goals', { goal: goalFromForm() });
    resetNewGoal();
    selectTab('existing');
    S.pickFile = r.goal_id;
    $('goalFileSelect').dataset.key = '';
    setGoal(r.goal_id);
    $('nlStatus').textContent = '';
    $('goalFileInfo').textContent = `Saved to goals/${r.file}.`;
  } catch (err) { showError(err.message); }
});

function resetNewGoal() {
  $('paneNew').reset();
  S.draft = null;
  $('nlResult').hidden = true;
  $('nlStatus').textContent = '';
  $('draftJsonBox').hidden = true;
  syncModeFields();
}

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-feed-trainer': '1' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
  return data;
}

function showError(msg) {
  const e = $('formError');
  e.textContent = msg || '';
  e.hidden = !msg;
}

$('startBtn').addEventListener('click', async () => {
  showError('');
  const live = document.querySelector('input[name="runmode"]:checked')?.value === 'live';
  let body;
  if (S.tab === 'fixture') body = { fixture: true, show_browser: $('fixtureShow').checked };
  else if (S.tab === 'new') {
    const form = $('paneNew');
    if (!form.reportValidity()) return;
    body = { goal: goalFromForm(), live };
  } else {
    const id = $('goalFileSelect').value;
    if (!id) return showError('Pick a goal or create a new one.');
    body = { goal_id: id, live };
  }
  if (live && S.tab !== 'fixture') {
    const real = S.tab === 'new' ? body.goal.account_type === 'real' : S.config?.account_type === 'real';
    if (real && !confirm('Run in full mode on a real account? The agent will like, save and search as you.')) return;
  }
  $('startBtn').disabled = true;
  try {
    const r = await post('/api/run', body);
    if (S.tab === 'new') { resetNewGoal(); selectTab('existing'); }
    setGoal(r.goal_id);
  } catch (err) {
    showError(err.message);
    $('startBtn').disabled = false;
  }
});

$('stopBtn').addEventListener('click', async () => {
  showError('');
  try { await post('/api/stop', {}); } catch (err) { showError(err.message); }
});

new ResizeObserver(() => schedule()).observe($('measChart'));
setInterval(() => { renderStatus(); renderStepper(); }, 1000);
connect();
