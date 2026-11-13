import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Log kroků agenta. Každý uzel grafu zapíše vstup (▶), výstup (✓) s dobou
 * trvání a změnou stavu, nebo chybu (✗). Uzly můžou přidat i dílčí kroky
 * (·), např. volání modelu nebo klik.
 *
 * Do konzole jde čitelný řádek, do souboru JSONL (jeden objekt na řádek),
 * ze kterého jde později stavět živý panel nebo graf.
 */
export type LogEvent = 'enter' | 'exit' | 'info' | 'warn' | 'error';

export interface LogRecord {
  ts: string;
  session: string;
  step: number;
  node: string;
  event: LogEvent;
  msg: string;
  ms?: number;
  data?: unknown;
}

const ICON: Record<LogEvent, string> = { enter: '▶', exit: '✓', info: '·', warn: '!', error: '✗' };
const COLOR: Record<LogEvent, string> = { enter: '36', exit: '32', info: '90', warn: '33', error: '31' };
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);

export class AgentLog {
  readonly session: string;
  readonly file: string | undefined;
  /** Pořadové číslo kroku grafu (zvyšuje se při každém vstupu do uzlu). */
  private step = 0;
  /** Úroveň konzole: "steps" = vše, "quiet" = jen výstupy uzlů, varování a chyby. */
  constructor(opts: { session?: string; file?: string; console?: 'steps' | 'quiet' | 'off' } = {}) {
    this.session = opts.session ?? new Date().toISOString().replace(/[:.]/g, '-');
    this.file = opts.file;
    this.consoleLevel = opts.console ?? 'steps';
    if (this.file) mkdirSync(dirname(this.file), { recursive: true });
  }
  private consoleLevel: 'steps' | 'quiet' | 'off';

  enter(node: string, msg = '', data?: unknown) {
    this.step++;
    this.write({ node, event: 'enter', msg, data });
  }
  exit(node: string, ms: number, msg = '', data?: unknown) { this.write({ node, event: 'exit', msg, ms, data }); }
  info(node: string, msg: string, data?: unknown) { this.write({ node, event: 'info', msg, data }); }
  warn(node: string, msg: string, data?: unknown) { this.write({ node, event: 'warn', msg, data }); }
  error(node: string, msg: string, data?: unknown) { this.write({ node, event: 'error', msg, data }); }

  private write(r: Omit<LogRecord, 'ts' | 'session' | 'step'>) {
    const rec: LogRecord = { ts: new Date().toISOString(), session: this.session, step: this.step, ...r };
    if (this.file) appendFileSync(this.file, JSON.stringify(rec) + '\n');
    if (this.consoleLevel === 'off') return;
    if (this.consoleLevel === 'quiet' && (r.event === 'enter' || r.event === 'info')) return;
    const time = rec.ts.slice(11, 23);
    const ms = r.ms !== undefined ? ` ${fmtMs(r.ms)}` : '';
    const line = `${paint('90', time)} ${paint('90', `#${String(this.step).padStart(4)}`)} ${r.node.padEnd(12)} ${paint(COLOR[r.event], ICON[r.event])}${ms} ${r.msg}`;
    (r.event === 'error' || r.event === 'warn' ? console.error : console.log)(line);
  }
}

const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);

/** Krátký text z hodnoty pro log (zkrácené řetězce, max. pár klíčů). */
export function brief(v: unknown, max = 60): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === 'string') return v.length > max ? `„${v.slice(0, max)}…“` : `„${v}“`;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === 'boolean') return v ? 'ano' : 'ne';
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined && x !== '');
    return `{${entries.slice(0, 5).map(([k, x]) => `${k}: ${typeof x === 'object' && x !== null ? (Array.isArray(x) ? `[${x.length}]` : '{…}') : brief(x, 30)}`).join(', ')}${entries.length > 5 ? ', …' : ''}}`;
  }
  return String(v);
}
