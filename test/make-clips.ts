// Vygeneruje krátká testová videa (WebM) přes canvas + MediaRecorder v prohlížeči,
// ať testovací stránka nepotřebuje ffmpeg ani videa z internetu.
import { chromium } from 'patchright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';

const cfg = loadConfig([]);
mkdirSync('test/fixture', { recursive: true });
const browser = await chromium.launch({ channel: cfg.channel === 'chromium' ? undefined : cfg.channel, headless: true });
const page = await browser.newPage();
await page.goto('about:blank');

const colors = ['#c0392b', '#2471a3', '#1e8449', '#7d3c98'];
const clips = await page.evaluate(async (colors) => {
  const record = (color: string, label: string) =>
    new Promise<string>((resolve) => {
      const c = document.createElement('canvas');
      c.width = 360; c.height = 640;
      const g = c.getContext('2d')!;
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm' });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = async () => {
        const buf = await new Blob(chunks).arrayBuffer();
        let s = '';
        new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
        resolve(btoa(s));
      };
      const t0 = performance.now();
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        g.fillStyle = color; g.fillRect(0, 0, 360, 640);
        g.fillStyle = '#fff'; g.font = 'bold 48px sans-serif'; g.fillText(label, 40, 120);
        g.beginPath(); g.arc(180 + Math.sin(t * 3) * 120, 360, 40, 0, Math.PI * 2); g.fill();
        g.fillText(t.toFixed(1) + 's', 120, 560);
        if (t < 4) requestAnimationFrame(draw); else rec.stop();
      };
      rec.start(); draw();
    });
  return Promise.all(colors.map((c, i) => record(c, `clip ${i + 1}`)));
}, colors);

clips.forEach((b64, i) => writeFileSync(`test/fixture/clip-${i + 1}.webm`, Buffer.from(b64, 'base64')));
console.log(`Hotovo: ${clips.length} klipy v test/fixture/`);
await browser.close();
