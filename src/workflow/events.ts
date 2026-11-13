import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Log událostí podle WORKFLOW.md, sekce 12: JSONL, jeden záznam na řádek
 * (reel, measurement, cycle_summary, stop, terminal, notify, …). Kroky grafu
 * se logují zvlášť přes AgentLog (src/log.ts).
 */
export class EventLog {
  readonly file: string;
  private readonly base: Record<string, unknown>;
  constructor(file: string, base: Record<string, unknown>) {
    this.file = file;
    this.base = base;
    mkdirSync(dirname(file), { recursive: true });
  }
  write(event: string, data: Record<string, unknown> = {}): void {
    appendFileSync(this.file, JSON.stringify({ ts: localIso(), ...this.base, event, ...data }) + '\n');
  }
}

/** ISO 8601 s posunem časového pásma (jako v příkladech v sekci 12). */
export function localIso(d = new Date()): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const pad = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, '0');
  const local = new Date(d.getTime() + off * 60_000).toISOString().slice(0, 19);
  return `${local}${sign}${pad(off / 60)}:${pad(off % 60)}`;
}
