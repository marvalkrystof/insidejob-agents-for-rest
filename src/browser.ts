import { chromium, type BrowserContext } from 'patchright';
import { resolve } from 'node:path';
import type { Config } from './config.ts';

/**
 * Lokálně je nejvěrohodnější fingerprint ten skutečný: tvůj Mac, tvoje GPU,
 * fonty, rozlišení a IP. Proto žádný podvržený fingerprint ani User-Agent,
 * jen opravdový Chrome/Edge s okny a trvalým profilem.
 *
 * Patchright je Playwright s odstraněnými stopami automatizace
 * (navigator.webdriver, únik Runtime.enable přes CDP, přepínače
 * --enable-automation apod.). V cloudu (Apify) se sem později dá vyměnit
 * Crawlee + fingerprint-suite, kde naopak podvržený fingerprint dává smysl.
 */
export async function launch(cfg: Config): Promise<BrowserContext> {
  return chromium.launchPersistentContext(resolve(cfg.profileDir), {
    channel: cfg.channel === 'chromium' ? undefined : cfg.channel,
    headless: cfg.headless,
    // viewport: null = skutečná velikost okna, žádná emulace.
    viewport: null,
    args: [
      '--window-size=1280,900',
      // Ať Chrome nebrzdí přehrávání, když okno překryje jiné okno.
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--disable-background-timer-throttling',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
}
