import type { Page } from 'patchright';
import { humanClick, humanType, humanWheel, moveMouse, pause, rand } from '../human.ts';
import * as ig from '../instagram.ts';

/**
 * Akce ze sekce 4 WORKFLOW.md, které nejsou v instagram.ts. Selektory pro
 * Explore, profil, unfollow a stránku zvuku zatím NEJSOU ověřené na živém
 * Instagramu: hledají se podle odkazů a aria-label a při nenalezení vrací
 * false / null, aby volající mohl zalogovat `selector_missing`.
 */
const BASE = 'https://www.instagram.com';

export interface Tile {
  index: number;
  href: string;
  code: string;
  alt: string;
  box: { x: number; y: number; width: number; height: number };
}

const isFile = (page: Page) => page.url().startsWith('file:');

export async function openReels(page: Page, reelsUrl: string): Promise<void> {
  if (isFile(page)) { await page.goto(reelsUrl); await pause(1500); return; }
  const link = page.getByRole('link', { name: ig.LABELS.reels }).first();
  const box = await link.boundingBox({ timeout: 1500 }).catch(() => null);
  if (box) {
    await humanClick(page, box);
    await page.waitForURL(/\/reels\//, { timeout: 8000 }).catch(() => page.goto(reelsUrl));
  } else {
    await page.goto(reelsUrl, { waitUntil: 'domcontentloaded' });
  }
  await pause(2500);
}

export async function openExplore(page: Page, exploreUrl = `${BASE}/explore/`): Promise<void> {
  const link = page.getByRole('link', { name: /^(explore|prozkoumat)$/i }).first();
  const box = isFile(page) ? null : await link.boundingBox({ timeout: 1500 }).catch(() => null);
  if (box) {
    await humanClick(page, box);
    await page.waitForURL(/\/explore\//, { timeout: 8000 }).catch(() => page.goto(exploreUrl));
  } else {
    await page.goto(exploreUrl, { waitUntil: 'domcontentloaded' });
  }
  await pause(3000);
}

/** Dlaždice mřížky (Explore, výsledky hledání, profil) v pořadí na stránce. */
export async function gridTiles(page: Page, max = 20): Promise<Tile[]> {
  const tiles = await page.evaluate((max) => {
    const seen = new Set<string>();
    const out: { href: string; code: string; alt: string; box: { x: number; y: number; width: number; height: number } }[] = [];
    for (const a of document.querySelectorAll<HTMLAnchorElement>('main a[href*="/p/"], main a[href*="/reel/"], a[data-tile]')) {
      const href = a.getAttribute('href') ?? '';
      const code = href.match(/\/(?:p|reels?)\/([\w-]+)/)?.[1] ?? href;
      if (seen.has(code)) continue;
      const r = a.getBoundingClientRect();
      if (r.width < 60 || r.height < 60) continue;
      seen.add(code);
      const img = a.querySelector('img');
      out.push({ href, code, alt: img?.getAttribute('alt') ?? a.getAttribute('aria-label') ?? a.innerText ?? '', box: { x: r.x, y: r.y + scrollY, width: r.width, height: r.height } });
      if (out.length >= max) break;
    }
    return out;
  }, max);
  return tiles.map((t, index) => ({ ...t, index }));
}

/** Snímek jedné dlaždice (pro Judge s obrázkem). Dlaždici nejdřív posune do okna. */
export async function tileScreenshot(page: Page, tile: Tile): Promise<Buffer | null> {
  const loc = page.locator(`a[href="${tile.href}"]`).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  return loc.screenshot({ type: 'jpeg', quality: 60, timeout: 3000 }).catch(() => null);
}

/** Otevře dlaždici kliknutím (otevře se modální okno s příspěvkem/reelem). */
export async function openTile(page: Page, tile: Tile): Promise<boolean> {
  const loc = page.locator(`a[href="${tile.href}"]`).first();
  await loc.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
  const box = await loc.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!box) return false;
  await humanClick(page, box);
  await pause(2500);
  return true;
}

/** Zpět: zavře modální okno (Escape), jinak historie prohlížeče. */
export async function back(page: Page): Promise<void> {
  const dialog = page.locator('[role="dialog"]').first();
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  } else {
    await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }
  await pause(1500);
}

export async function openProfile(page: Page, author: string): Promise<boolean> {
  if (!author) return false;
  const link = page.locator(`a[href="/${author}/"], a[href="/${author}/reels/"]`).first();
  const box = await link.boundingBox({ timeout: 1500 }).catch(() => null);
  if (box) await humanClick(page, box);
  else await page.goto(`${BASE}/${author}/`, { waitUntil: 'domcontentloaded' });
  await pause(2500);
  return isFile(page) || page.url().includes(`/${author}`);
}

/** Na profilu: Follow. Vrací false, když tlačítko není (už sledovaný, nebo se změnilo UI). */
export async function followOnProfile(page: Page): Promise<boolean> {
  const btn = page.getByRole('button', { name: ig.LABELS.follow }).first();
  const box = await btn.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!box) return false;
  await humanClick(page, box);
  await pause(1500);
  return true;
}

/** Na profilu: Following → Unfollow v dialogu. */
export async function unfollowOnProfile(page: Page): Promise<boolean> {
  const following = page.getByRole('button', { name: /^(following|sleduji|sledováno)/i }).first();
  const box = await following.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!box) return false;
  await humanClick(page, box);
  await pause(1200);
  const confirm = page.getByRole('button', { name: /^(unfollow|přestat sledovat|zrušit sledování)$/i })
    .or(page.getByText(/^(unfollow|přestat sledovat|zrušit sledování)$/i)).first();
  const cbox = await confirm.boundingBox({ timeout: 2000 }).catch(() => null);
  if (!cbox) { await page.keyboard.press('Escape'); return false; }
  await humanClick(page, cbox);
  await pause(1500);
  return true;
}

/** Stránka zvuku aktuálního reelu. */
export async function openAudio(page: Page): Promise<boolean> {
  const link = page.locator('[data-ft-active] a[href*="/audio/"]').first();
  const box = await link.boundingBox({ timeout: 1500 }).catch(() => null);
  if (!box) return false;
  await humanClick(page, box);
  await pause(rand(3000, 6000));
  return true;
}

/**
 * Hledání (sekce 4: search + open_search_result). Napíše dotaz lidsky do
 * vyhledávání v levém menu a potvrdí; když UI nenajde, otevře stránku
 * výsledků podle klíčového slova. Vrací true, když jsou vidět výsledky.
 */
export async function search(page: Page, query: string): Promise<boolean> {
  if (isFile(page)) return false;
  try {
    const link = page.getByRole('link', { name: ig.LABELS.search }).first();
    const lbox = await link.boundingBox({ timeout: 2000 });
    if (!lbox) throw new Error('search link');
    await humanClick(page, lbox);
    const input = page.getByPlaceholder(ig.LABELS.search).or(page.getByRole('textbox', { name: ig.LABELS.search })).first();
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await pause(600);
    await humanType(page, query);
    await pause(rand(2000, 4000));
    await page.keyboard.press('Enter');
    await pause(2500);
  } catch {
    // Záloha: stránka výsledků podle klíčového slova (mřížka příspěvků a reels).
  }
  if (!/\/explore\/search\//.test(page.url())) {
    await page.goto(`${BASE}/explore/search/keyword/?q=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' });
    await pause(3000);
  }
  return (await gridTiles(page, 5)).length > 0;
}

/** Občas odscrollovat mřížku (Explore). */
export async function scrollGrid(page: Page): Promise<void> {
  const { vw, vh } = await page.evaluate(() => ({ vw: innerWidth, vh: innerHeight }));
  await moveMouse(page, { x: vw * rand(0.3, 0.7), y: vh * rand(0.4, 0.6) });
  for (let i = 0; i < 3; i++) { await humanWheel(page, vh * rand(0.25, 0.4)); await pause(700, 0.4); }
}

