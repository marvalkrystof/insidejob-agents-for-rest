// Lokální aplikace pro řízení agenta: spouští a zastavuje běh (src/main.ts nebo
// test/run-fixture.ts) jako samostatný proces a v reálném čase posílá do panelu
// v prohlížeči všechno, co agent zapisuje (logs/*.jsonl, data/state.json).
//
// Kód agenta se nemění: aplikace čte jen soubory, které agent už píše, takže
// ukáže i běh spuštěný z terminálu.
//
// Spuštění: npm run app  →  http://localhost:4321
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import { BUDGETS, CYCLES_PER_DAY, normalizeGoal, type GoalConfig, type Mode } from '../src/workflow/goal.ts';
import { compileGoal } from './compile.ts';

const ROOT = resolve(import.meta.dirname, '..');
const PUBLIC = join(ROOT, 'app', 'public');
const LOGS = join(ROOT, 'logs');
const GOALS = join(ROOT, 'goals');
const STATE_FILES = [join(ROOT, 'data', 'state.json'), join(ROOT, 'data-test', 'state.json')];
const PORT = Number(process.env.APP_PORT ?? 4321);
const HOST = '127.0.0.1';
const FIXTURE_GOAL = 'fixture-test';
/** Vlastní hlavička na POST: stránka z jiného webu ji bez CORS preflightu neposlat nemůže. */
const CSRF_HEADER = 'x-feed-trainer';

// ───────────────────────────── soubory ─────────────────────────────

type Json = Record<string, unknown>;

function readJson<T = Json>(file: string): T | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as T; } catch { return null; }
}

function parseLines(text: string): Json[] {
  const out: Json[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as Json); } catch { /* neúplný nebo poškozený řádek */ }
  }
  return out;
}

function readJsonl(file: string, maxLines = 20_000): Json[] {
  if (!existsSync(file)) return [];
  const all = parseLines(readFileSync(file, 'utf8'));
  return all.length > maxLines ? all.slice(-maxLines) : all;
}

const mtime = (file: string) => { try { return statSync(file).mtimeMs; } catch { return 0; } };

function listFiles(dir: string, re: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => re.test(f)).map((f) => join(dir, f));
}

/** Čte jen nově připsané řádky souboru. Když se soubor zkrátí nebo zmizí, ohlásí reset. */
class Tailer {
  readonly file: string;
  private offset = 0;
  private rest = '';
  constructor(file: string, fromEnd: boolean) {
    this.file = file;
    if (fromEnd) this.offset = existsSync(file) ? statSync(file).size : 0;
  }
  poll(): { lines: Json[]; reset: boolean } {
    let size = 0;
    try { size = statSync(this.file).size; } catch { size = 0; }
    let reset = false;
    if (size < this.offset) { this.offset = 0; this.rest = ''; reset = true; }
    if (size === this.offset) return { lines: [], reset };
    const fd = openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      this.offset = size;
      const text = this.rest + buf.toString('utf8');
      const cut = text.lastIndexOf('\n');
      this.rest = cut === -1 ? text : text.slice(cut + 1);
      return { lines: cut === -1 ? [] : parseLines(text.slice(0, cut)), reset };
    } finally {
      closeSync(fd);
    }
  }
}

// ───────────────────────────── cíle ─────────────────────────────

const eventsFile = (goalId: string) => join(LOGS, `events-${goalId}.jsonl`);

interface GoalSummary {
  goal_id: string;
  target_topic: string;
  file: string | null;
  status: string | null;
  terminal: string | null;
  last_activity: number;
}

function goalFiles(): Map<string, { file: string; raw: Json }> {
  const m = new Map<string, { file: string; raw: Json }>();
  for (const f of listFiles(GOALS, /\.json$/)) {
    const raw = readJson(f);
    if (raw && typeof raw.goal_id === 'string') m.set(raw.goal_id, { file: f, raw });
  }
  return m;
}

function stateFor(goalId: string): { file: string; state: Json; gs: Json } | null {
  for (const f of STATE_FILES) {
    const st = readJson(f);
    const gs = (st?.goals as Record<string, Json> | undefined)?.[goalId];
    if (st && gs) return { file: f, state: st, gs };
  }
  return null;
}

function listGoals(): GoalSummary[] {
  const map = new Map<string, GoalSummary>();
  const touch = (id: string, patch: Partial<GoalSummary>) => {
    const cur = map.get(id) ?? { goal_id: id, target_topic: id, file: null, status: null, terminal: null, last_activity: 0 };
    map.set(id, { ...cur, ...patch, last_activity: Math.max(cur.last_activity, patch.last_activity ?? 0) });
  };
  for (const [id, g] of goalFiles()) touch(id, { file: basename(g.file), target_topic: String(g.raw.target_topic ?? id), last_activity: mtime(g.file) });
  for (const f of listFiles(LOGS, /^events-.+\.jsonl$/)) touch(basename(f).slice(7, -6), { last_activity: mtime(f) });
  for (const sf of STATE_FILES) {
    const st = readJson(sf);
    for (const [id, gs] of Object.entries((st?.goals as Record<string, Json>) ?? {})) {
      touch(id, { target_topic: String(gs.target_topic ?? id), status: (gs.status as string) ?? null, terminal: (gs.terminal as string) ?? null });
    }
  }
  return [...map.values()].sort((a, b) => b.last_activity - a.last_activity);
}

/** Konfigurace cíle pro panel: ze souboru v goals/, jinak odvozená z goal_start. */
function goalConfig(goalId: string, events: Json[]): GoalConfig | null {
  const g = goalFiles().get(goalId);
  if (g) {
    try { return normalizeGoal(g.raw as unknown as GoalConfig); } catch { /* neplatný soubor */ }
  }
  const start = events.find((e) => e.event === 'goal_start');
  const st = stateFor(goalId);
  if (!start && !st) return null;
  const mode = (start?.mode as Mode) ?? 'safe';
  return normalizeGoal({
    goal_id: goalId,
    target_topic: String(start?.target_topic ?? st?.gs.target_topic ?? goalId),
    mode,
    account_type: mode === 'safe' ? 'real' : 'test',
  });
}

function defaultGoal(): string | null {
  if (proc.child && proc.goalId) return proc.goalId;
  const active = readJson(STATE_FILES[0]!)?.active_goal_id;
  if (typeof active === 'string') return active;
  return listGoals()[0]?.goal_id ?? null;
}

function stateView(goalId: string) {
  const s = stateFor(goalId);
  if (!s) return null;
  return {
    file: basename(join(s.file, '..')) + '/' + basename(s.file),
    goal: s.gs,
    budgets: s.state.budgets ?? null,
    cooldown_until: s.state.cooldown_until ?? null,
    active_goal_id: s.state.active_goal_id ?? null,
  };
}

const slug = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

/** Uloží nový cíl z formuláře do goals/<goal_id>.json (WORKFLOW.md, sekce 3). */
function createGoal(input: Json): { goal: GoalConfig; file: string } {
  const topic = String(input.target_topic ?? '').trim();
  if (!topic) throw new HttpError(400, 'Chybí téma, které chceš ve feedu vidět víc.');
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : String(v ?? '').split(',')).map((x) => x.trim()).filter(Boolean);
  const day = new Date().toISOString().slice(0, 10);
  const taken = new Set(listGoals().map((g) => g.goal_id));
  let id = `${slug(topic) || 'cil'}-${day}`;
  for (let i = 2; taken.has(id); i++) id = `${slug(topic) || 'cil'}-${day}-${i}`;
  const num = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
  // Staré téma: z formuláře text („vaření, pečení“), z kompilátoru [{topic, description}].
  const olds = Array.isArray(input.old_topics) && input.old_topics.some((o) => typeof o === 'object')
    ? (input.old_topics as Json[]).map((o) => ({ topic: String(o.topic ?? '').trim(), description: String(o.description ?? o.topic ?? '').trim() })).filter((o) => o.topic)
    : list(input.old_topics).map((t) => ({ topic: t, description: t }));
  // Popisy starých témat z kompilátoru se drží, i když formulář posílá jen názvy.
  const oldDesc = new Map(((input.old_topics_detail as Json[] | undefined) ?? []).map((o) => [String(o.topic).toLowerCase(), String(o.description ?? '')]));
  const ah = input.active_hours as Json | undefined;
  const hm = (v: unknown) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)) ? String(v) : null;
  const ta = num(input.target_alignment);
  const raw = {
    goal_id: id,
    target_topic: topic,
    target_description: String(input.target_description ?? '').trim() || topic,
    subtopics: list(input.subtopics),
    old_topics: olds.map((o) => ({ ...o, description: oldDesc.get(o.topic.toLowerCase()) || o.description })),
    ...(list(input.languages).length ? { languages: list(input.languages) } : {}),
    account_type: input.account_type === 'test' ? 'test' : 'real',
    mode: input.mode === 'fast' ? 'fast' : 'safe',
    ...(ta !== null && ta >= 0.2 && ta <= 0.9 ? { target_alignment: ta } : {}),
    verify_persistence: input.verify_persistence === true,
    on_success: input.on_success === 'maintain' ? 'maintain' : 'stop',
    seeds_enabled: input.seeds_enabled !== false,
    limits: {
      max_cycles: num(input.max_cycles),
      max_active_minutes: num(input.max_active_minutes),
      max_days: num(input.max_days),
      max_cost_usd: num(input.max_cost_usd),
      hard_stop_at: input.hard_stop_at && !Number.isNaN(Date.parse(String(input.hard_stop_at))) ? new Date(String(input.hard_stop_at)).toISOString() : null,
    },
    ...(ah && hm(ah.from) && hm(ah.to) ? { active_hours: { from: hm(ah.from), to: hm(ah.to), timezone: String(ah.timezone ?? 'Europe/Prague') } } : {}),
    ...(typeof input.source_query === 'string' && input.source_query.trim() ? { source_query: input.source_query.trim().slice(0, 2000) } : {}),
  };
  const goal = normalizeGoal(raw as unknown as GoalConfig);
  mkdirSync(GOALS, { recursive: true });
  const file = join(GOALS, `${id}.json`);
  // Ukládá se zadání (null = výchozí limit podle režimu), ne doplněná konfigurace.
  writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  return { goal, file };
}

// ───────────────────────────── proces agenta ─────────────────────────────

interface ProcState {
  child: ChildProcess | null;
  goalId: string | null;
  kind: 'agent' | 'fixture' | null;
  live: boolean;
  startedAt: number | null;
  stopping: boolean;
  exit: { code: number | null; signal: string | null; at: number } | null;
  out: string[];
}

const proc: ProcState = { child: null, goalId: null, kind: null, live: false, startedAt: null, stopping: false, exit: null, out: [] };
/** Soubory s kroky session spuštěných z aplikace (po skončení se nemají hlásit jako běh z terminálu). */
const appSessions = new Set<string>();

const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

/** Poslední soubor s kroky (steps-*.jsonl), volitelně jen pro daný cíl. Kroky se logují po session. */
function newestSteps(goalId?: string | null): string | null {
  let files = listFiles(LOGS, /^steps-.+\.jsonl$/);
  if (goalId) files = files.filter((f) => stepsGoal(f) === goalId);
  if (!files.length) return null;
  return files.reduce((a, b) => (mtime(b) > mtime(a) ? b : a));
}

/** Ke kterému cíli session patří: první záznam uzlu "session" obsahuje „cíl <goal_id> (…“. */
const stepsGoalCache = new Map<string, string | null>();
function stepsGoal(file: string): string | null {
  const hit = stepsGoalCache.get(file);
  if (hit) return hit;
  let goal: string | null = null;
  try {
    const fd = openSync(file, 'r');
    const buf = Buffer.alloc(16_384);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    for (const r of parseLines(buf.subarray(0, n).toString('utf8'))) {
      const m = r.node === 'session' ? /cíl (\S+) \(/.exec(String(r.msg)) : null;
      if (m) { goal = m[1]!; break; }
    }
  } catch { /* soubor zmizel */ }
  // Neznámý cíl se necachuje: záznam session se může zapsat až za chvíli.
  if (goal) stepsGoalCache.set(file, goal);
  return goal;
}

/**
 * Běží session spuštěná mimo aplikaci (z terminálu)? Odhad podle posledního
 * kroku: zapsaný před chvílí, nebo dlouhé čekání (pauza, měření), které ještě neskončilo.
 */
let lastStepCache: { file: string; mtime: number; last: Json | undefined } | null = null;
function lastStep(f: string): Json | undefined {
  const m = mtime(f);
  if (lastStepCache?.file === f && lastStepCache.mtime === m) return lastStepCache.last;
  // Stačí konec souboru, ne celý log.
  const size = statSync(f).size;
  const len = Math.min(size, 8192);
  const fd = openSync(f, 'r');
  const buf = Buffer.alloc(len);
  try { readSync(fd, buf, 0, len, size - len); } finally { closeSync(fd); }
  const last = parseLines(buf.toString('utf8')).at(-1);
  lastStepCache = { file: f, mtime: m, last };
  return last;
}

function sessionActive(f: string): boolean {
  const age = Date.now() - mtime(f);
  if (age < 90_000) return true;
  if (age > 40 * 60_000) return false;
  const last = lastStep(f);
  return last?.event === 'enter' && ['pause', 'pauseDay', 'finalM', 'measure', 'persistWait'].includes(String(last.node));
}

/**
 * Session běžící mimo aplikaci (z terminálu). `blocking` = používá skutečný
 * profil prohlížeče, takže by se s ní agent spuštěný z aplikace pral; test na
 * napodobenině (fixture-test) má vlastní profil a neblokuje.
 */
function externalRun(): { active: boolean; since: number | null; goals: string[]; blocking: boolean } {
  const goals = new Set<string>();
  let since: number | null = null;
  for (const f of listFiles(LOGS, /^steps-.+\.jsonl$/)) {
    const g = stepsGoal(f);
    if (proc.child && g === proc.goalId) continue;
    if (appSessions.has(f)) continue;
    if (!sessionActive(f)) continue;
    goals.add(g ?? '?');
    since = Math.max(since ?? 0, mtime(f));
  }
  const list = [...goals];
  return { active: list.length > 0, since, goals: list, blocking: list.some((g) => g !== FIXTURE_GOAL) };
}

function procView() {
  const ext = externalRun();
  return {
    running: !!proc.child,
    goal_id: proc.goalId,
    kind: proc.kind,
    live: proc.live,
    started_at: proc.startedAt,
    stopping: proc.stopping,
    exit: proc.exit,
    external: ext.active,
    external_since: ext.since,
    external_goals: ext.goals,
    external_blocking: ext.blocking,
    has_featherless: !!process.env.FEATHERLESS_API_KEY?.trim(),
    has_apify: !!process.env.APIFY_TOKEN?.trim(),
  };
}

function pushOut(text: string) {
  for (const raw of text.split('\n')) {
    const line = stripAnsi(raw).trimEnd();
    if (!line) continue;
    proc.out.push(line);
    if (proc.out.length > 500) proc.out.shift();
    broadcast('out', { line });
  }
}

function startRun(body: Json) {
  if (proc.child) throw new HttpError(409, 'Agent už běží. Nejdřív ho zastav.');
  // Test na napodobenině má vlastní profil (.profile-test), ale sdílí data-test a log
  // fixture-test s jiným testem; agent sdílí profil .profile s během z terminálu.
  const ext = externalRun();
  if (body.fixture === true && ext.goals.includes(FIXTURE_GOAL)) {
    throw new HttpError(409, 'Z terminálu už běží jiný test na napodobenině (sdílí data-test/). Počkej, až skončí.');
  }
  if (body.fixture !== true && ext.blocking) {
    throw new HttpError(409, `Právě běží session spuštěná z terminálu (${ext.goals.join(', ')}), prohlížeč s profilem je obsazený. Zastav ji tam, nebo počkej, až skončí.`);
  }

  let args: string[];
  let goalId: string;
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' };
  if (body.fixture === true) {
    goalId = FIXTURE_GOAL;
    args = ['--env-file-if-exists=.env', 'test/run-fixture.ts'];
    env.HEADLESS = body.show_browser === false ? '1' : '0';
    env.VERBOSE = '1';
  } else {
    let file: string;
    if (body.goal && typeof body.goal === 'object') {
      const created = createGoal(body.goal as Json);
      goalId = created.goal.goal_id;
      file = created.file;
    } else {
      goalId = String(body.goal_id ?? '');
      const g = goalFiles().get(goalId);
      if (!g) throw new HttpError(404, `Cíl ${goalId} nemá soubor v goals/. Vytvoř nový cíl.`);
      file = g.file;
      // Skončený cíl agent hned ukončí (start → end), což v aplikaci vypadá jako pád.
      const gs = stateFor(goalId)?.gs;
      if (gs?.terminal && gs.status !== 'maintaining') {
        throw new HttpError(409, `Cíl ${goalId} už skončil (${String(gs.terminal)}). Vyber jiný cíl, nebo vytvoř nový.`);
      }
    }
    args = ['--env-file-if-exists=.env', 'src/main.ts', '--goal', file, body.live === true ? '--live' : '--dry-run'];
  }

  const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  Object.assign(proc, {
    child, goalId, kind: body.fixture === true ? 'fixture' : 'agent', live: body.fixture === true || body.live === true,
    startedAt: Date.now(), stopping: false, exit: null, out: [],
  });
  pushOut(`$ node ${args.slice(1).join(' ')}`);
  child.stdout?.setEncoding('utf8').on('data', pushOut);
  child.stderr?.setEncoding('utf8').on('data', pushOut);
  child.on('error', (err) => pushOut(`Nepodařilo se spustit agenta: ${err.message}`));
  child.on('exit', (code, signal) => {
    const startedAt = proc.startedAt ?? 0;
    for (const f of listFiles(LOGS, /^steps-.+\.jsonl$/)) {
      if (stepsGoal(f) === goalId && mtime(f) >= startedAt) appSessions.add(f);
    }
    proc.child = null;
    proc.stopping = false;
    proc.exit = { code, signal, at: Date.now() };
    pushOut(`— agent skončil (${signal ?? `kód ${code}`})`);
    broadcast('proc', procView());
    broadcast('goals', { goals: listGoals() });
  });
  broadcast('proc', procView());
  broadcast('goals', { goals: listGoals() });
  return { goal_id: goalId };
}

/** První Stop = Ctrl+C (agent dokončí akci a zapíše stav), druhý = okamžité ukončení. */
function stopRun() {
  if (!proc.child) throw new HttpError(409, 'Agent neběží.');
  if (proc.stopping) {
    proc.child.kill('SIGINT');
    setTimeout(() => proc.child?.kill('SIGKILL'), 5000).unref();
  } else {
    proc.stopping = true;
    proc.child.kill('SIGINT');
  }
  broadcast('proc', procView());
}

// ───────────────────────────── realtime (SSE) ─────────────────────────────

interface Client { res: ServerResponse; goalId: string | null }
const clients = new Set<Client>();

function send(c: Client, type: string, data: unknown) {
  c.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}
function broadcast(type: string, data: unknown, goalId?: string) {
  for (const c of clients) if (goalId === undefined || c.goalId === goalId) send(c, type, data);
}

function snapshot(goalId: string | null) {
  const events = goalId ? readJsonl(eventsFile(goalId)) : [];
  const config = goalId ? goalConfig(goalId, events) : null;
  const steps = goalId ? newestSteps(goalId) : null;
  return {
    goal_id: goalId,
    goals: listGoals(),
    config,
    budgets: config ? BUDGETS[config.mode] : null,
    cycles_per_day: config ? CYCLES_PER_DAY[config.mode] : null,
    events,
    state: goalId ? stateView(goalId) : null,
    steps: steps ? readJsonl(steps, 400) : [],
    proc: procView(),
    out: proc.out,
  };
}

const eventTailers = new Map<string, Tailer>();
const stepsTailers = new Map<string, Tailer>();
/** Který soubor s kroky má klient právě zobrazený (aby šlo poznat novou session). */
const clientSteps = new WeakMap<Client, string>();
const stateMtimes = new Map<string, number>();
let lastProc = '';
/** Při startu se existující logy čtou od konce; soubory, které vzniknou později, od začátku. */
let scanned = false;
let scannedSteps = false;

function tick() {
  // Události po cílech
  for (const f of listFiles(LOGS, /^events-.+\.jsonl$/)) if (!eventTailers.has(f)) eventTailers.set(f, new Tailer(f, !scanned));
  scanned = true;
  for (const [f, t] of eventTailers) {
    const goalId = basename(f).slice(7, -6);
    const { lines, reset } = t.poll();
    if (reset) broadcast('reset', { goal_id: goalId }, goalId);
    else if (lines.length) broadcast('events', { lines }, goalId);
  }
  // Kroky: každá session má vlastní soubor; klient dostává kroky nejnovější session svého cíle.
  const recent = listFiles(LOGS, /^steps-.+\.jsonl$/).filter((f) => Date.now() - mtime(f) < 6 * 3600_000);
  for (const f of recent) if (!stepsTailers.has(f)) stepsTailers.set(f, new Tailer(f, !scannedSteps));
  scannedSteps = true;
  const fresh = new Map<string, Json[]>();
  for (const [f, t] of stepsTailers) {
    const { lines } = t.poll();
    if (lines.length) fresh.set(f, lines);
  }
  for (const c of clients) {
    if (!c.goalId) continue;
    const want = newestSteps(c.goalId);
    if (!want) continue;
    if (clientSteps.get(c) !== want) {
      clientSteps.set(c, want);
      send(c, 'steps_reset', { file: basename(want), lines: readJsonl(want, 400) });
      continue;
    }
    const lines = fresh.get(want);
    if (lines) send(c, 'steps', { lines });
  }
  // Trvalý stav
  for (const f of STATE_FILES) {
    const m = mtime(f);
    if (m && m !== stateMtimes.get(f)) {
      stateMtimes.set(f, m);
      for (const c of clients) {
        if (!c.goalId) continue;
        const v = stateView(c.goalId);
        if (v) send(c, 'state', v);
      }
    }
  }
  // Stav procesu (i běh z terminálu)
  const pv = JSON.stringify(procView());
  if (pv !== lastProc) { lastProc = pv; broadcast('proc', JSON.parse(pv)); }
}
setInterval(tick, 400).unref();
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 15_000).unref();

// ───────────────────────────── HTTP ─────────────────────────────

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, msg: string) { super(msg); this.status = status; }
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
};

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Json> {
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (text.length > 100_000) throw new HttpError(413, 'Příliš velký požadavek.');
  }
  try { return text ? (JSON.parse(text) as Json) : {}; } catch { throw new HttpError(400, 'Neplatný JSON.'); }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  try {
    if (req.method === 'POST') {
      if (req.headers[CSRF_HEADER] !== '1') throw new HttpError(403, 'Chybí hlavička aplikace.');
      const body = await readBody(req);
      if (url.pathname === '/api/run') return json(res, 200, startRun(body));
      if (url.pathname === '/api/compile') {
        try {
          return json(res, 200, await compileGoal(String(body.text ?? ''), { apiKey: process.env.FEATHERLESS_API_KEY?.trim() || undefined }));
        } catch (err) {
          throw new HttpError(422, (err as Error).message);
        }
      }
      if (url.pathname === '/api/goals') {
        const { goal, file } = createGoal((body.goal ?? {}) as Json);
        broadcast('goals', { goals: listGoals() });
        return json(res, 200, { goal_id: goal.goal_id, file: basename(file) });
      }
      if (url.pathname === '/api/stop') { stopRun(); return json(res, 200, { ok: true }); }
      throw new HttpError(404, 'Neznámá akce.');
    }

    if (url.pathname === '/api/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const c: Client = { res, goalId: url.searchParams.get('goal') || defaultGoal() };
      // Nejdřív rozeslat čekající řádky ostatním, ať je nový klient nedostane dvakrát
      // (jednou ve snímku a podruhé jako přírůstek).
      tick();
      clients.add(c);
      const snap = snapshot(c.goalId);
      const sf = c.goalId ? newestSteps(c.goalId) : null;
      if (sf) clientSteps.set(c, sf);
      send(c, 'snapshot', snap);
      req.on('close', () => clients.delete(c));
      return;
    }
    if (url.pathname === '/api/goals') return json(res, 200, { goals: listGoals(), files: [...goalFiles().keys()] });
    if (url.pathname === '/api/goal-defaults') {
      return json(res, 200, { modes: { fast: normalizeGoal({ goal_id: 'x', target_topic: 'x', account_type: 'test', mode: 'fast' }).limits, safe: normalizeGoal({ goal_id: 'x', target_topic: 'x', account_type: 'real' }).limits } });
    }

    // Statické soubory panelu
    const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const file = join(PUBLIC, name);
    if (!file.startsWith(PUBLIC + '/') || !existsSync(file) || !TYPES[extname(file)]) throw new HttpError(404, 'Nenalezeno.');
    res.writeHead(200, { 'content-type': TYPES[extname(file)]!, 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    json(res, status, { error: (err as Error).message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Feed Trainer běží na http://localhost:${PORT}`);
  console.log(`Featherless: ${process.env.FEATHERLESS_API_KEY ? 'ano' : 'ne (jen klíčová slova)'} · Apify: ${process.env.APIFY_TOKEN ? 'ano' : 'ne'}`);
});

// Ctrl+C na serveru zastaví i agenta (dostane SIGINT od terminálu, tady jen počkáme).
process.on('SIGINT', () => {
  if (proc.child) {
    console.log('\nZastavuji agenta…');
    proc.child.once('exit', () => process.exit(0));
    setTimeout(() => process.exit(0), 15_000).unref();
  } else process.exit(0);
});
