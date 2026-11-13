import type { ElementHandle, Locator, Page } from 'patchright';
import { chance, flickDistance, humanClick, humanWheel, inside, mouseAt, moveMouse, pause, pointIn, rand, sleep } from './human.ts';

/**
 * Všechno, co závisí na DOM Instagramu, je v tomhle souboru. Instagram má
 * zamaskované CSS třídy, takže hledáme podle aria-label a textu. Ty jsou
 * lokalizované, proto každý regex pokrývá češtinu i angličtinu.
 */
export const LABELS = {
  like: /^(like|to se mi líbí|líbí se mi)$/i,
  unlike: /^(unlike|už se mi nelíbí|to se mi už nelíbí|nelíbí se mi)$/i,
  save: /^(save|uložit)$/i,
  unsave: /^(remove|odebrat|odstranit|zrušit uložení)$/i,
  more: /^(more|more options|další|další možnosti|více možností|více)$/i,
  notInterested: /^(not interested|nemám zájem|nezajímá mě to)$/i,
  follow: /^(follow|sledovat)$/i,
  search: /^(search|hledat|vyhledávání|vyhledat)$/i,
  reels: /^(reels)$/i,
  nextReel: /^(navigate to next reel|next reel|přejít na další reel|další reel|přejít na další)$/i,
  blocked: /(try again later|we restrict certain activity|action blocked|zkuste to znovu později|omezujeme určité aktivity|akce byla zablokována)/i,
};

/** Atribut, kterým si označíme kontejner aktuálního reelu. */
const MARK = 'data-ft-active';

export interface ReelMeta {
  author: string;
  caption: string;
  audio: string;
}

export interface ActiveReel {
  id: string;
  /**
   * Identita videa na stránce: vlastní značka elementu <video> + konec jeho
   * zdroje. Instagram mění URL (id) se zpožděním a elementy recykluje, takže
   * posun na další reel se pozná spolehlivě jen podle tohohle klíče.
   */
  vkey: string;
  duration: number;
  meta: ReelMeta;
}

/** Jsme opravdu na Instagramu? (ne na stránce síťového filtru, přesměrování apod.) */
export function onInstagram(page: Page): boolean {
  try {
    return /(^|\.)instagram\.com$/.test(new URL(page.url()).hostname);
  } catch {
    return false;
  }
}

/**
 * Stránky, kde přihlášení ještě probíhá: formulář, 2FA, captcha, ověření
 * ("byl jsi to ty?"), "uložit údaje" apod. Na nich agent na nic nesahá.
 */
const LOGIN_FLOW = /\/accounts\/|\/challenge\/|\/auth_platform\/|\/two_factor|\/captcha|\/checkpoint/;

/** Instagram nastaví cookie `sessionid` až po úspěšném přihlášení (po 2FA i captche). */
export async function hasSession(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies('https://www.instagram.com');
  return cookies.some((c) => c.name === 'sessionid' && c.value.length > 0);
}

export async function isLoggedIn(page: Page): Promise<boolean> {
  if (!onInstagram(page) || LOGIN_FLOW.test(new URL(page.url()).pathname)) return false;
  if (!(await hasSession(page))) return false;
  // Session může Instagram zrušit, i když cookie zůstane: pak ukazuje
  // tlačítka Log in / Sign up nebo přihlašovací zeď.
  const loggedOutUi = page
    .locator('input[name="username"], a[href^="/accounts/login"], a[href^="/accounts/emailsignup"]')
    .or(page.getByRole('button', { name: /^(log in|sign up|přihlásit se|zaregistrovat se)$/i }))
    .or(page.getByRole('link', { name: /^(log in|sign up|přihlásit se|zaregistrovat se)$/i }));
  return (await loggedOutUi.count()) === 0;
}

/**
 * Otevře přihlašovací stránku a počká, až se člověk přihlásí sám: jméno,
 * heslo, 2FA, captchu i ověření dělá on, agent heslo nevidí a dokud
 * Instagram nenastaví session cookie, na nic v okně nesahá. Pak zavře
 * "Uložit údaje?" a přejde na Reels. Přihlášení zůstane v profilu.
 */
export async function loginFlow(page: Page, reelsUrl: string, timeoutMs = 15 * 60_000): Promise<void> {
  const loginUrl = `https://www.instagram.com/accounts/login/?next=${encodeURIComponent(new URL(reelsUrl).pathname)}`;
  await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();

  const until = Date.now() + timeoutMs;
  let lastStep = '';
  while (Date.now() < until) {
    if (page.isClosed()) throw new Error('Okno prohlížeče bylo zavřeno.');
    const session = onInstagram(page) && (await hasSession(page));
    const path = onInstagram(page) ? new URL(page.url()).pathname : '';
    const step = !onInstagram(page) ? 'mimo Instagram (potvrď případné upozornění sítě)'
      : /two_factor/.test(path) ? 'dvoufázové ověření (zadej kód)'
      : /challenge|auth_platform|checkpoint|captcha/.test(path) ? `ověření / captcha od Instagramu (${path})`
      : /onetap/.test(path) ? 'dialog „Uložit údaje?“'
      : /\/accounts\/login/.test(path) && !session ? 'čekám na jméno a heslo'
      : !session ? `čekám na dokončení přihlášení (${path})`
      : 'přihlášeno, kontroluju';
    if (step !== lastStep) { console.log(`   … ${step}`); lastStep = step; }

    if (session && /onetap/.test(path)) {
      await dismissDialogs(page);
    } else if (session && !LOGIN_FLOW.test(path)) {
      // Chvíli počkat, ať se po přihlášení stránka ustálí (přesměrování, dialogy).
      await pause(3000);
      if (await isLoggedIn(page)) {
        console.log('✓ Přihlášeno.\n');
        await dismissDialogs(page);
        if (!/\/reels\//.test(page.url())) await page.goto(reelsUrl, { waitUntil: 'domcontentloaded' });
        await pause(3000);
        return;
      }
    }
    await sleep(1500);
  }
  throw new Error('Přihlášení nedokončeno do 15 minut.');
}

/** Zavře běžné dialogy po přihlášení ("Uložit údaje?", "Zapnout oznámení?"). */
export async function dismissDialogs(page: Page): Promise<void> {
  const notNow = page
    .getByRole('button', { name: /^(not now|teď ne|nyní ne|zrušit)$/i })
    .or(page.getByText(/^(not now|teď ne|nyní ne)$/i));
  for (let i = 0; i < 2; i++) {
    const btn = notNow.first();
    if (!(await btn.isVisible().catch(() => false))) break;
    const box = await btn.boundingBox().catch(() => null);
    if (!box) break;
    await pause(900);
    await humanClick(page, box);
    await pause(1500);
  }
}

export async function isActionBlocked(page: Page): Promise<boolean> {
  const dialogs = page.locator('[role="dialog"], [role="alertdialog"]');
  const n = await dialogs.count();
  for (let i = 0; i < n; i++) {
    const text = await dialogs.nth(i).innerText().catch(() => '');
    if (LABELS.blocked.test(text)) return true;
  }
  return /\/challenge\//.test(page.url());
}

/**
 * Najde video, které je teď uprostřed obrazovky, a označí jeho kontejner
 * (nejbližší předek, který obsahuje i tlačítko Like, ale ne další video).
 */
/**
 * Přečte reel na obrazovce (offset 0) a označí jeho kontejner, nebo reel
 * `offset` pozic pod ním (Instagram drží v DOM i několik dalších reels):
 * ten se neoznačuje a jeho id je složené z autora a popisku, protože URL
 * se mění až po přepnutí.
 */
export async function readActiveReel(page: Page, offset = 0): Promise<ActiveReel | null> {
  const res = await page.evaluate(
    ({ mark, like, unlike, offset }) => {
      const likeRe = new RegExp(like, 'i');
      const unlikeRe = new RegExp(unlike, 'i');
      const vh = innerHeight;
      const videos = [...document.querySelectorAll('video')]
        .map((v) => ({ v, r: v.getBoundingClientRect() }))
        .filter(({ r }) => r.height > 100 && r.bottom > 0 && r.top < vh)
        .map(({ v, r }) => {
          const visible = Math.min(r.bottom, vh) - Math.max(r.top, 0);
          return { v, visible: visible / r.height, center: Math.abs(r.top + r.height / 2 - vh / 2) };
        })
        .sort((a, b) => b.visible - a.visible || a.center - b.center);
      const best = videos[0];
      if (!best || best.visible < 0.6) return null;
      let video = best.v;
      if (offset > 0) {
        // Další reels v pořadí na stránce (pod aktuálním).
        const all = [...document.querySelectorAll('video')]
          .map((v) => ({ v, top: v.getBoundingClientRect().top }))
          .sort((a, b) => a.top - b.top);
        const idx = all.findIndex((x) => x.v === video);
        const next = all[idx + offset]?.v;
        if (!next) return null;
        video = next;
      }

      const isLikeBtn = (el: Element) => {
        const l = el.getAttribute('aria-label') ?? '';
        return likeRe.test(l) || unlikeRe.test(l);
      };
      let box: HTMLElement = video.parentElement!;
      let node: HTMLElement | null = video.parentElement;
      while (node && node !== document.body) {
        if (node.querySelectorAll('video').length > 1) break;
        box = node;
        if ([...node.querySelectorAll('[aria-label]')].some(isLikeBtn)) break;
        node = node.parentElement;
      }
      if (offset === 0) {
        document.querySelectorAll(`[${mark}]`).forEach((el) => el.removeAttribute(mark));
        box.setAttribute(mark, '1');
      }

      // Autor: odkaz na profil, na webových Reels má tvar /<jmeno>/reels/ (jinde /<jmeno>/).
      const reserved = /^(reels?|p|explore|stories|accounts|direct|audio|tv)$/;
      const author =
        [...box.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')]
          .map((a) => (a.getAttribute('href') ?? '').match(/^\/([\w.]+)\/(?:reels\/)?$/)?.[1])
          .find((name): name is string => !!name && !reserved.test(name)) ?? '';

      // Hudba: odkazů na /audio/ je víc (ikona, text), vezmeme první s textem.
      const audio =
        [...box.querySelectorAll<HTMLAnchorElement>('a[href*="/audio/"]')]
          .map((a) => a.innerText.trim().split('\n')[0])
          .find((t) => t.length > 0) ?? '';

      // Popisek: nejdelší textový blok. Na Reels je to rozbalovací div[role=button]
      // i s hashtagy, takže tlačítka nevyřazujeme, jen čísla, "Follow" a jméno autora.
      const noise = /^(follow|following|sledovat|sleduji|•|…|more|další|press to play|see translation|zobrazit překlad|[\d.,\s]+(k|m|tis\.|mil\.)?)$/i;
      const texts = [...box.querySelectorAll<HTMLElement>('div[role="button"], span[dir="auto"], div[dir="auto"], h1')]
        .filter((el) => !el.closest('a[href*="/audio/"]') && !el.querySelector('video, svg[aria-label], a[href$="/reels/"]'))
        .map((el) =>
          (el.innerText ?? '')
            .replace(/\b(see translation|zobrazit překlad)\b/gi, '')
            .replace(/\s*(…|\.\.\.)\s*(more|další)$/i, '')
            .trim(),
        )
        .filter((t) => t.length > 1 && t !== author && t !== audio && !noise.test(t));
      const tags = [...box.querySelectorAll('a[href^="/explore/tags/"]')].map((a) => (a as HTMLElement).innerText.trim());
      let caption = texts.sort((a, b) => b.length - a.length)[0] ?? '';
      const missing = tags.filter((t) => !caption.includes(t));
      if (missing.length) caption = `${caption} ${missing.join(' ')}`.trim();

      // ID: Instagram mění URL při každém reelu (/reels/<kód>/).
      const fromUrl = offset === 0 ? location.pathname.match(/^\/reels?\/([\w-]+)\/?$/)?.[1] : undefined;
      const id =
        fromUrl ??
        box.querySelector<HTMLAnchorElement>('a[href*="/reel/"]')?.getAttribute('href') ??
        `${author}|${caption.slice(0, 60)}|${video.currentSrc.slice(-40)}`;

      if (!video.dataset.ftVid) {
        const seq = Number(document.documentElement.dataset.ftVidSeq ?? 0) + 1;
        document.documentElement.dataset.ftVidSeq = String(seq);
        video.dataset.ftVid = String(seq);
      }
      const vkey = `${video.dataset.ftVid}|${(video.currentSrc || video.src).slice(-24)}`;
      return { id, vkey, duration: Number.isFinite(video.duration) ? video.duration : 0, meta: { author, caption, audio } };
    },
    { mark: MARK, like: LABELS.like.source + '|' + LABELS.unlike.source, unlike: LABELS.unlike.source, offset },
  );
  return res;
}

const active = (page: Page) => page.locator(`[${MARK}]`);
const activeVideo = (page: Page) => active(page).locator('video').first();

/** Najde tlačítko v aktivním reelu podle aria-label (na tlačítku nebo uvnitř na svg). */
async function findButton(page: Page, label: RegExp): Promise<Locator | null> {
  const scope = active(page);
  const direct = scope.getByRole('button', { name: label }).first();
  if (await direct.isVisible().catch(() => false)) return direct;

  const svgs = scope.locator('svg[aria-label]');
  const n = await svgs.count();
  for (let i = 0; i < n; i++) {
    const svg = svgs.nth(i);
    const l = (await svg.getAttribute('aria-label')) ?? '';
    if (label.test(l)) {
      const btn = svg.locator('xpath=ancestor-or-self::*[@role="button" or self::button][1]');
      return (await btn.count()) ? btn.first() : svg;
    }
  }
  return null;
}

async function clickButton(page: Page, label: RegExp): Promise<boolean> {
  const btn = await findButton(page, label);
  if (!btn) return false;
  await btn.scrollIntoViewIfNeeded().catch(() => {});
  const box = await btn.boundingBox();
  if (!box) return false;
  await humanClick(page, box);
  return true;
}

export async function hasLabel(page: Page, label: RegExp): Promise<boolean> {
  return (await findButton(page, label)) !== null;
}

export const like = async (page: Page) =>
  !(await hasLabel(page, LABELS.unlike)) && clickButton(page, LABELS.like);

export const save = async (page: Page) =>
  !(await hasLabel(page, LABELS.unsave)) && clickButton(page, LABELS.save);

export const follow = (page: Page) => clickButton(page, LABELS.follow);

/** Menu "…" → "Nemám zájem". Když položka v menu není, menu zavře. */
export async function notInterested(page: Page): Promise<boolean> {
  if (!(await clickButton(page, LABELS.more))) return false;
  await pause(900);
  const item = page.getByRole('button', { name: LABELS.notInterested })
    .or(page.getByRole('menuitem', { name: LABELS.notInterested }))
    .or(page.getByText(LABELS.notInterested))
    .first();
  if (await item.isVisible().catch(() => false)) {
    const box = await item.boundingBox();
    if (box) {
      await humanClick(page, box);
      await pause(1200);
      return true;
    }
  }
  await page.keyboard.press('Escape');
  return false;
}

/** Stav přehrávání aktuálního videa. */
export async function videoState(page: Page) {
  return activeVideo(page)
    .evaluate((v: HTMLVideoElement) => ({ t: v.currentTime, d: v.duration, paused: v.paused, ended: v.ended }), undefined, { timeout: 1000 })
    .catch(() => null);
}

/** Klikne do videa, když se samo nepustilo (autoplay). */
export async function ensurePlaying(page: Page): Promise<void> {
  const s = await videoState(page);
  if (!s || !s.paused) return;
  const box = await activeVideo(page).boundingBox({ timeout: 1000 }).catch(() => null);
  if (box) await humanClick(page, { x: box.x + box.width * 0.3, y: box.y + box.height * 0.3, width: box.width * 0.4, height: box.height * 0.3 });
}

/**
 * Kouká na aktuální reel, dokud skutečně neuplyne `targetSec` přehraného
 * času (počítá se z video.currentTime, takže buffering se nezapočítá).
 * Vrací přehraný čas a počet smyček.
 */
export async function watch(page: Page, targetSec: number, maxWallSec = targetSec * 2 + 10) {
  let played = 0;
  let loops = 0;
  let last: number | null = null;
  const start = Date.now();
  const until = start + maxWallSec * 1000;
  let nudged = false;
  while (played < targetSec && Date.now() < until) {
    await sleep(rand(220, 320));
    const s = await videoState(page);
    if (!s) break;
    if (s.paused && !nudged && Date.now() - start > 1500) {
      nudged = true;
      await ensurePlaying(page);
    }
    if (last !== null) {
      const dt = s.t - last;
      if (dt > 0 && dt < 1.5) played += dt;
      else if (dt < -1 && s.d > 0 && last > s.d - 1.5) {
        // Skok na začátek těsně od konce = video doběhlo a jede znovu.
        // Jinde je to přetočení (Instagram po startu video restartuje), to nepočítat.
        loops++;
        played += Math.max(0, s.d - last) + s.t;
      }
    }
    last = s.t;
    // Občas pohnout myší po videu, jak to lidi dělají.
    if (chance(0.03)) {
      const box = await activeVideo(page).boundingBox({ timeout: 1000 }).catch(() => null);
      if (box) await moveMouse(page, pointIn(box, 0.15));
    }
  }
  return { played, loops };
}

/** Přejde na další reel: kolečko myši, a když se reel nezměnil, šipka dolů. */
/**
 * Oblast, nad kterou jde scrollovat feed: scroll-snap kontejner oříznutý na
 * okno. Wheel jde do prvku pod kurzorem, takže mimo něj (levé menu) by se
 * feed nepohnul.
 */
async function feedArea(page: Page) {
  const area = await page.evaluate(() => {
    const sc = [...document.querySelectorAll('div')].find((e) => getComputedStyle(e).scrollSnapType.includes('y'));
    if (!sc) return null;
    const r = sc.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    return { x, y, width: Math.min(innerWidth, r.right) - x, height: Math.min(innerHeight, r.bottom) - y };
  });
  if (area && area.width > 100 && area.height > 100) return area;
  return activeVideo(page).boundingBox({ timeout: 1000 }).catch(() => null);
}

/** Čeká až ~2,5 s, jestli se aktivní reel změnil. */
/** Je na obrazovce jiné video než `prev`? (podle vkey, ne podle URL) */
const changed = (r: ActiveReel | null, prev: ActiveReel) => !!r && r.vkey !== prev.vkey;

/**
 * Čeká až ~3 s, jestli se aktivní reel změnil. Po změně ještě počká, až se
 * scroll usadí (dvakrát po sobě stejné video), ať se nečte reel v půlce posunu.
 */
async function advanced(page: Page, prev: ActiveReel): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    await sleep(250);
    const r = await readActiveReel(page);
    if (changed(r, prev)) {
      await sleep(300);
      const again = await readActiveReel(page);
      return changed(again, prev);
    }
  }
  return false;
}

/** Je na obrazovce pořád stejný reel? (před like, uložením a follow) */
export async function stillOn(page: Page, reel: ActiveReel): Promise<boolean> {
  const r = await readActiveReel(page);
  return !!r && r.vkey === reel.vkey;
}

/**
 * Klikne na šipku dolů vpravo ("Navigate to next Reel" ve skupině
 * "Reels navigation controls"). Když ji nenajde podle popisku, vezme druhé
 * tlačítko z té skupiny.
 */
async function clickNextArrow(page: Page): Promise<boolean> {
  const byLabel = page.getByRole('button', { name: LABELS.nextReel }).first();
  const fallback = page.locator('[role="toolbar"] [role="button"]').nth(1);
  for (const btn of [byLabel, fallback]) {
    const box = await btn.boundingBox({ timeout: 800 }).catch(() => null);
    if (box) {
      await humanClick(page, box);
      return true;
    }
  }
  return false;
}

async function swipe(page: Page, vh: number, attempt: number): Promise<void> {
  const area = await feedArea(page);
  if (area && !(inside(mouseAt(page), area) && chance(0.35))) {
    await moveMouse(page, pointIn(area, rand(0.05, 0.2)));
    await pause(180, 0.5);
  }
  await humanWheel(page, flickDistance(vh) * (1 + attempt * rand(0.1, 0.25)));
}

/**
 * Přejde na další reel. Většinou švihnutím: kurzor je pokaždé jinde (kdekoli
 * nad feedem a občas zůstane, kde byl) a švihnutí má pokaždé jinou sílu.
 * Občas klikne na šipku dolů vpravo, jak to lidi na desktopu taky dělají.
 * Když švihnutí nechytne (krátký swipe), zkusí šipku, nebo švihne znovu
 * silněji. Šipka na klávesnici je až poslední záchrana.
 */
export async function nextReel(page: Page, prev: ActiveReel): Promise<boolean> {
  const vh = await page.evaluate(() => innerHeight);

  if (chance(0.2) && (await clickNextArrow(page)) && (await advanced(page, prev))) return true;

  for (let attempt = 0; attempt < 3; attempt++) {
    await swipe(page, vh, attempt);
    if (await advanced(page, prev)) return true;
    await pause(500, 0.4);
    // Zadrhnutí: po prvním nezdaru většinou klik na šipku, po druhém vždycky.
    if ((attempt === 0 && chance(0.6)) || attempt === 1) {
      if ((await clickNextArrow(page)) && (await advanced(page, prev))) return true;
      await pause(400, 0.4);
    }
  }
  await page.keyboard.press('ArrowDown');
  await pause(1500);
  return changed(await readActiveReel(page), prev);
}

/** Snímek aktuálního reelu (jen oblast videa) jako JPEG pro vision model. */
export async function screenshotActive(page: Page): Promise<Buffer | null> {
  const el: ElementHandle | null = await activeVideo(page).elementHandle({ timeout: 1000 }).catch(() => null);
  if (!el) return null;
  return el.screenshot({ type: 'jpeg', quality: 60 }).catch(() => null);
}

/**
 * Vypíše strukturu aktuálního reelu (aria-label, odkazy, texty), aby se
 * daly opravit selektory, kdyby Instagram změnil DOM.
 */
export async function describeActive(page: Page) {
  return active(page).evaluate((box) => ({
    tag: box.tagName,
    ariaLabels: [...box.querySelectorAll('[aria-label]')].map((e) => `${e.tagName.toLowerCase()}: ${e.getAttribute('aria-label')}`),
    links: [...box.querySelectorAll('a[href]')].map((a) => `${a.getAttribute('href')} "${(a as HTMLElement).innerText.trim().slice(0, 40)}"`),
    buttons: [...box.querySelectorAll('[role="button"], button')].map((b) => (b as HTMLElement).innerText.trim().slice(0, 40) || b.getAttribute('aria-label') || '(bez textu)'),
    text: (box as HTMLElement).innerText.slice(0, 800),
  }), undefined, { timeout: 2000 }).catch((e: Error) => ({ error: e.message }));
}
