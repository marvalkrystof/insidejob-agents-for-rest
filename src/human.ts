import type { Page } from 'patchright';

/** Náhodné číslo v intervalu. */
export const rand = (min: number, max: number) => min + Math.random() * (max - min);

export const chance = (p: number) => Math.random() < p;

/**
 * Lidské prodlevy nemají rovnoměrné rozdělení: většina je krátkých, občas
 * přijde dlouhá. Log-normální rozdělení kolem mediánu to napodobí líp.
 */
export function humanMs(medianMs: number, spread = 0.35): number {
  const u = 1 - Math.random();
  const v = Math.random();
  const gauss = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(30, medianMs * Math.exp(gauss * spread));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const pause = (medianMs: number, spread?: number) => sleep(humanMs(medianMs, spread));

interface Point { x: number; y: number }
interface Box { x: number; y: number; width: number; height: number }

/**
 * Pohyb myši po Bézierově křivce s proměnnou rychlostí a lehkým
 * přestřelením, místo teleportu rovnou na cíl. Pozice myši si pamatujeme
 * per stránku, protože Playwright ji nevrací.
 */
const mousePos = new WeakMap<Page, Point>();

export async function moveMouse(page: Page, to: Point): Promise<void> {
  const viewport = page.viewportSize() ?? (await page.evaluate(() => ({ width: innerWidth, height: innerHeight })));
  const from = mousePos.get(page) ?? { x: rand(0.3, 0.7) * viewport.width, y: rand(0.3, 0.7) * viewport.height };
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  if (dist < 2) return;

  const bend = () => rand(-0.25, 0.25) * dist;
  const c1 = { x: from.x + (to.x - from.x) * rand(0.2, 0.4) + bend(), y: from.y + (to.y - from.y) * rand(0.2, 0.4) + bend() };
  const c2 = { x: from.x + (to.x - from.x) * rand(0.6, 0.8) + bend(), y: from.y + (to.y - from.y) * rand(0.6, 0.8) + bend() };
  const overshoot = dist > 150 && chance(0.3);
  const end = overshoot ? { x: to.x + rand(-8, 8), y: to.y + rand(-8, 8) } : to;

  const steps = Math.round(Math.min(60, Math.max(12, dist / rand(8, 14))));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; // ease-in-out
    const x = cubic(from.x, c1.x, c2.x, end.x, e);
    const y = cubic(from.y, c1.y, c2.y, end.y, e);
    await page.mouse.move(x, y);
    await sleep(rand(4, 12));
  }
  if (overshoot) {
    await sleep(rand(40, 110));
    await page.mouse.move(to.x, to.y, { steps: Math.round(rand(3, 6)) });
  }
  mousePos.set(page, to);
}

function cubic(a: number, b: number, c: number, d: number, t: number) {
  const m = 1 - t;
  return m * m * m * a + 3 * m * m * t * b + 3 * m * t * t * c + t * t * t * d;
}

/** Bod uvnitř prvku, ne přesně uprostřed (lidi neklikají do středu). */
export function pointIn(box: Box, pad = 0.25): Point {
  return {
    x: box.x + box.width * rand(pad, 1 - pad),
    y: box.y + box.height * rand(pad, 1 - pad),
  };
}

export async function humanClick(page: Page, box: Box): Promise<void> {
  await moveMouse(page, pointIn(box));
  await sleep(humanMs(120, 0.4));
  await page.mouse.down();
  await sleep(rand(55, 130));
  await page.mouse.up();
}

/**
 * Švihnutí kolečkem/trackpadem: rychlá série wheel událostí (zhruba jedna
 * za snímek), které postupně slábnou, jako setrvačnost trackpadu. Počet
 * událostí, rozestupy, útlum i drobný boční posun jsou pokaždé jiné a občas
 * přijde po krátké pauze ještě slabý "dojezd".
 *
 * Instagram Reels má scroll-snap: pomalé nebo malé pohyby vrátí zpátky na
 * stejný reel, přepne až rychlý pohyb kolem 60 % výšky reelu a víc.
 */
export async function humanWheel(page: Page, totalDy: number): Promise<void> {
  const ticks = Math.round(rand(4, 11));
  const decay = rand(0.18, 0.45);
  const tail = chance(0.25) ? rand(0.03, 0.08) : 0; // podíl na dojezd
  const weights = Array.from({ length: ticks }, (_, i) => Math.exp(-i * decay) * rand(0.8, 1.2));
  const sum = weights.reduce((a, b) => a + b, 0);
  const main = totalDy * (1 - tail);
  const drift = rand(-0.02, 0.02); // ruka nejde úplně svisle
  for (const w of weights) {
    const dy = (main * w) / sum;
    await page.mouse.wheel(dy * drift + rand(-1, 1), dy);
    await sleep(rand(10, 24));
  }
  if (tail) {
    await sleep(rand(60, 140));
    const n = Math.round(rand(1, 3));
    for (let i = 0; i < n; i++) {
      await page.mouse.wheel(0, (totalDy * tail) / n);
      await sleep(rand(16, 30));
    }
  }
}

/**
 * Jak daleko švihnout, v násobcích výšky okna. Pokaždé jinak, většinou
 * kolem 0,95, nikdy pod 0,75 (to by na Reels nechytlo).
 */
export function flickDistance(viewportHeight: number): number {
  // Dolní mez 0,75: slabší švihnutí na Reels často nechytla a opakování dělalo přeskakování nerovnoměrné.
  return viewportHeight * Math.min(1.5, Math.max(0.75, humanMs(950, 0.18) / 1000));
}

/** Poslední známá pozice myši (pokud jsme s ní už hýbali). */
export const mouseAt = (page: Page): Point | undefined => mousePos.get(page);

export const inside = (p: Point | undefined, b: Box): p is Point =>
  !!p && p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y && p.y <= b.y + b.height;

/** Psaní s nestejnými mezerami mezi znaky. */
export async function humanType(page: Page, text: string): Promise<void> {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(humanMs(ch === ' ' ? 160 : 110, 0.45));
  }
}
