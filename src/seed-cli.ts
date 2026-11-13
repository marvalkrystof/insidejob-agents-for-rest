// Samostatné vyzkoušení stavu "seed" bez prohlížeče:
//   npm run seed -- --tags supercars,porsche,motorsport
//   npm run seed -- --keywords "car review" --users topgear
import { parseArgs } from 'node:util';
import { fetchSeedReels } from './seed.ts';

const { values } = parseArgs({
  options: {
    tags: { type: 'string', default: '' },
    keywords: { type: 'string', default: '' },
    users: { type: 'string', default: '' },
    take: { type: 'string', default: '8' },
    per: { type: 'string', default: '15' },
  },
});
const list = (s: string | undefined) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

const token = process.env.APIFY_TOKEN?.trim();
if (!token) {
  console.error('Chybí APIFY_TOKEN v .env (Apify Console → Settings → API & Integrations).');
  process.exit(1);
}

const t0 = Date.now();
const reels = await fetchSeedReels({
  token,
  hashtags: list(values.tags),
  keywords: list(values.keywords),
  usernames: list(values.users),
  take: Number(values.take),
  perSource: Number(values.per),
});
console.log(`Seed: ${reels.length} reels za ${Math.round((Date.now() - t0) / 1000)} s\n`);
for (const r of reels) {
  console.log(`${r.reelsUrl}  @${r.owner}  ${r.durationSec.toFixed(0)} s  ${r.plays.toLocaleString('cs-CZ')} přehrání  [${r.source}]`);
  console.log(`   ${r.caption.replace(/\s+/g, ' ').slice(0, 100)}`);
}
