import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';

export type Channel = 'chrome' | 'msedge' | 'chromium';

export interface Config {
  goal: string;
  keywords: string[];
  featherlessKey: string | undefined;
  apifyToken: string | undefined;
  textModel: string;
  visionModel: string;
  channel: Channel;
  headless: boolean;
  profileDir: string;
  reelsUrl: string;
  dryRun: boolean;
  inspect: boolean;
  /** Cesta ke konfiguraci cíle (WORKFLOW.md, sekce 3). Bez ní se cíl odvodí z GOAL. */
  goalFile: string | undefined;
  /**
   * Zrychlení dlouhých čekání pro rychlé iterování (pauzy, délka F3, studený start,
   * pauza před FINAL_M). Tempo reakcí na reel a protokol M zůstávají skutečné. 1 = normál.
   */
  timeScale: number;
  /** --stop-in N: pevný konec za N minut od spuštění (přepíše hard_stop_at cíle). */
  stopInMinutes: number | undefined;
}

const list = (s: string | undefined) =>
  (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

function defaultChannel(): Channel {
  if (process.platform === 'darwin') {
    if (existsSync('/Applications/Google Chrome.app')) return 'chrome';
    if (existsSync('/Applications/Microsoft Edge.app')) return 'msedge';
  }
  if (process.platform === 'win32') return 'chrome';
  return 'chromium';
}

export function loadConfig(argv = process.argv.slice(2)): Config {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      inspect: { type: 'boolean', default: false },
      goal: { type: 'string' },
      iterate: { type: 'boolean', default: false },
      'stop-in': { type: 'string' },
      'dry-run': { type: 'boolean' },
      live: { type: 'boolean' },
    },
  });
  const env = process.env;

  const goal = positionals.join(' ').trim() || env.GOAL?.trim() || 'auta, superauta a motorsport';
  const keywords = list(env.KEYWORDS).length
    ? list(env.KEYWORDS)
    : goal.toLowerCase().split(/[,;]|\s+a\s+|\s+and\s+/).map((s) => s.trim()).filter((s) => s.length > 2);

  let dryRun = env.DRY_RUN !== '0' && env.DRY_RUN !== 'false';
  if (values['dry-run']) dryRun = true;
  if (values.live) dryRun = false;

  const model = 'Qwen/Qwen3-VL-30B-A3B-Instruct';

  return {
    goal,
    keywords,
    featherlessKey: env.FEATHERLESS_API_KEY?.trim() || undefined,
    apifyToken: env.APIFY_TOKEN?.trim() || undefined,
    // Text i obrázky: Qwen3-VL-30B. Qwen2.5-7B byl rychlejší, ale na skutečných (nic
    // neříkajících) popiscích hádal t=1,0 i s "důkazem"; VL-30B dal 0 falešných shod (2026-11-13).
    textModel: env.TEXT_MODEL?.trim() || 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    visionModel: env.VISION_MODEL?.trim() || model,
    channel: (env.BROWSER_CHANNEL?.trim() as Channel) || defaultChannel(),
    headless: env.HEADLESS === '1',
    profileDir: env.PROFILE_DIR?.trim() || '.profile',
    reelsUrl: env.REELS_URL?.trim() || 'https://www.instagram.com/reels/',
    dryRun,
    inspect: values.inspect ?? false,
    goalFile: values.goal ?? (env.GOAL_FILE?.trim() || undefined),
    timeScale: values.iterate ? 0.15 : Number(env.TIME_SCALE ?? 1),
    stopInMinutes: values['stop-in'] ? Number(values['stop-in']) : undefined,
  };
}
