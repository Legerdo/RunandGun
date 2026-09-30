// Playwright harness: drives the game frame-by-frame through window.__rr and captures screens.
// usage: node tools/play.mjs <scenario> [--url=http://localhost:5173/] [--audio]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith('--')) ?? 'smoke';
const urlArg = args.find((a) => a.startsWith('--url='));
const base = urlArg ? urlArg.slice(6) : 'http://localhost:5173/';
const withAudio = args.includes('--audio');
const outDir = path.resolve('tools/shots');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-gl=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 800, height: 460 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
await page.goto(`${base}?test${withAudio ? '' : '&mute'}${args.includes('--god') ? '&god' : ''}`);
await page.waitForFunction(() => !!window.__rr);
await page.waitForTimeout(300);

const H = {
  async start(section = 0) { await page.evaluate((s) => window.__rr.start(s), section); },
  async step(n, held = {}) { await page.evaluate(([n, h]) => window.__rr.step(n, h), [n, held]); },
  async state() { return page.evaluate(() => window.__rr.state()); },
  async perf() { return page.evaluate(() => window.__rr.perf()); },
  async eval(fn, arg) { return page.evaluate(fn, arg); },
  async frameData() { return page.evaluate(() => document.getElementById('screen').toDataURL('image/png')); },
  async shot(name, scale = 2) {
    const url = await page.evaluate((k) => {
      const src = document.getElementById('screen');
      const c = document.createElement('canvas');
      c.width = src.width * k; c.height = src.height * k;
      const x = c.getContext('2d');
      x.imageSmoothingEnabled = false;
      x.drawImage(src, 0, 0, c.width, c.height);
      return c.toDataURL('image/png');
    }, scale);
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return file;
  },
  // capture `count` frames every `every` steps while holding `held`, into one contact sheet
  async sheet(name, count, every, held = {}, cols = 3, scale = 1, label = true) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      if (typeof held === 'function') await held(every);
      else await H.step(every, held);
      const st = await H.state();
      frames.push({ url: await H.frameData(), t: st.t });
    }
    const url = await page.evaluate(async ([frames, cols, scale, label]) => {
      const imgs = await Promise.all(frames.map((f) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = f.url; })));
      const w = imgs[0].width * scale, h = imgs[0].height * scale;
      const rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = w * cols + (cols - 1) * 2; c.height = h * rows + (rows - 1) * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#ff00ff'; x.fillRect(0, 0, c.width, c.height);
      x.imageSmoothingEnabled = false;
      imgs.forEach((im, i) => {
        const cx = (i % cols) * (w + 2), cy = Math.floor(i / cols) * (h + 2);
        x.drawImage(im, cx, cy, w, h);
        if (label) { x.fillStyle = '#000'; x.fillRect(cx, cy + h - 12, 44, 12); x.fillStyle = '#0f0'; x.font = '10px monospace'; x.fillText('t' + frames[i].t, cx + 2, cy + h - 3); }
      });
      return c.toDataURL('image/png');
    }, [frames, cols, scale, label]);
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return file;
  },
  // zoomed contact sheet around a world point (default: the player)
  async zsheet(name, count, every, held = {}, o = {}) {
    const cw = o.w ?? 96, ch = o.h ?? 64, k = o.scale ?? 4, cols = o.cols ?? 4;
    const frames = [];
    for (let i = 0; i < count; i++) {
      await H.step(every, typeof held === 'function' ? held(i) : held);
      const r = await page.evaluate(([cw, ch, k, target]) => {
        const g = window.__rr.game;
        const t = target ? eval(target) : { x: g.player.x, y: g.player.y - 16 };
        const sx = Math.round(t.x - g.cam.x - cw / 2), sy = Math.round(t.y - g.cam.y - ch / 2);
        const src = document.getElementById('screen');
        const c = document.createElement('canvas');
        c.width = cw * k; c.height = ch * k;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;
        x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height);
        x.drawImage(src, sx, sy, cw, ch, 0, 0, cw * k, ch * k);
        x.fillStyle = '#0f0'; x.font = '12px monospace'; x.fillText('t' + g.t + ' ' + (g.player.state), 3, 12);
        return c.toDataURL('image/png');
      }, [cw, ch, k, o.target ?? null]);
      frames.push(r);
    }
    const url = await page.evaluate(async ([frames, cols]) => {
      const imgs = await Promise.all(frames.map((f) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = f; })));
      const w = imgs[0].width, h = imgs[0].height, rows = Math.ceil(imgs.length / cols);
      const c = document.createElement('canvas');
      c.width = w * cols + (cols - 1) * 2; c.height = h * rows + (rows - 1) * 2;
      const x = c.getContext('2d');
      x.fillStyle = '#ff00ff'; x.fillRect(0, 0, c.width, c.height);
      imgs.forEach((im, i) => x.drawImage(im, (i % cols) * (w + 2), Math.floor(i / cols) * (h + 2)));
      return c.toDataURL('image/png');
    }, [frames, cols]);
    const file = path.join(outDir, `${name}.png`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    return file;
  },
  log(...a) { console.log(...a); },
};

const mod = await import(`./scenarios.mjs`);
const fn = mod[scenario];
if (!fn) {
  console.error('unknown scenario', scenario, Object.keys(mod));
  process.exit(1);
}
try {
  await fn(H);
} catch (e) {
  console.error('SCENARIO ERROR', e);
  process.exitCode = 1;
}
const errs = logs.filter((l) => l.includes('error') || l.includes('pageerror'));
if (errs.length) process.exitCode = 1;
if (logs.length) console.log('--- browser log (' + logs.length + ' lines, ' + errs.length + ' errors) ---\n' + logs.slice(-25).join('\n'));
await browser.close();
