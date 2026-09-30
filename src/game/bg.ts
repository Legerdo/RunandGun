import { Surface, bayer, mix, rgb, hex, OUTLINE } from '../engine/surface';
import { C } from './palette';

// Procedural background painters. All work in screen space (s.ox = s.oy = 0).

export function gradient(s: Surface, y0: number, y1: number, stops: number[]) {
  const n = stops.length - 1;
  for (let y = Math.max(0, y0); y < Math.min(s.h, y1); y++) {
    const t = ((y - y0) / Math.max(1, y1 - y0)) * n;
    const i = Math.min(n - 1, Math.floor(t));
    const f = t - i;
    const a = stops[i], b = stops[i + 1];
    const row = y * s.w;
    for (let x = 0; x < s.w; x++) s.px[row + x] = bayer(x, y) < f ? b : a;
  }
}

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

// Tiled parallax image layer. `y` is the screen y of the top of the image.
export function layer(s: Surface, img: Surface, cx: number, par: number, y: number, cy = 0, parY = 0) {
  const off = Math.floor(cx * par) % img.w;
  let x = -off;
  if (x > 0) x -= img.w;
  const yy = Math.round(y - cy * parY);
  while (x < s.w) {
    s.blit(img, x, yy);
    x += img.w;
  }
}

export function clouds(s: Surface, cx: number, par: number, y: number, t: number, col: number, shadow: number, seed = 1, count = 6, drift = 0.05) {
  const span = 700;
  for (let i = 0; i < count; i++) {
    const bx = hash(seed * 31 + i) * span;
    let x = ((bx - cx * par - t * drift) % span + span) % span - 100;
    const yy = y + hash(seed * 17 + i) * 30;
    const w = 26 + hash(seed * 7 + i) * 40;
    const lobes = 4 + ((hash(i + seed) * 3) | 0);
    for (let k = 0; k < lobes; k++) {
      const lx = x + (k / (lobes - 1)) * w;
      const r = 5 + hash(i * 13 + k + seed) * 7 * (1 - Math.abs(k / (lobes - 1) - 0.5));
      s.disc(lx, yy - r * 0.4 + 1, r, shadow);
    }
    for (let k = 0; k < lobes; k++) {
      const lx = x + (k / (lobes - 1)) * w;
      const r = 5 + hash(i * 13 + k + seed) * 7 * (1 - Math.abs(k / (lobes - 1) - 0.5));
      s.disc(lx - 1, yy - r * 0.4 - 1, r - 1, col);
    }
    s.rect(x - 2, yy, w + 4, 2, shadow);
    void x;
  }
}

// Rolling silhouette (hills / dunes / distant cliffs).
export function ridge(s: Surface, cx: number, par: number, base: number, amp: number, col: number, seed: number, top?: number) {
  const o = cx * par;
  for (let x = 0; x < s.w; x++) {
    const wx = x + o;
    const h = Math.sin(wx * 0.013 + seed) * 0.5 + Math.sin(wx * 0.031 + seed * 2) * 0.3 + Math.sin(wx * 0.071 + seed * 3) * 0.2;
    const y = Math.round(base - amp * (0.5 + 0.5 * h));
    s.rect(x, y, 1, s.h - y, col);
    if (top !== undefined) s.pset(x, y, top);
  }
}

export function sea(s: Surface, y0: number, y1: number, cx: number, par: number, t: number, deep: number, mid: number, hi: number) {
  gradient(s, y0, y1, [mid, deep]);
  const o = cx * par;
  for (let y = y0 + 2; y < y1; y += 3) {
    const k = (y - y0) / (y1 - y0);
    const len = 3 + k * 10;
    const gap = 18 + k * 20;
    const shift = (o * (0.4 + k) + t * (0.15 + k * 0.2) + y * 37) % gap;
    for (let x = -shift; x < s.w; x += gap) {
      const wob = Math.sin((x + o) * 0.05 + t * 0.05 + y) > 0 ? 1 : 0;
      s.hline(x + wob * 2, x + len + wob * 2, y, hi);
    }
  }
}

export function sun(s: Surface, x: number, y: number, r: number, col: number, glow: number) {
  for (let i = 3; i >= 1; i--) s.ddisc(x, y, r + i * 6, glow, 0.25 + (3 - i) * 0.15);
  s.disc(x, y, r, col);
}

// ------------------------------------------------------------------ world-space decor

export function palm(s: Surface, x: number, y: number, h: number, t: number, lean = 6, seed = 0) {
  // trunk: segmented curve
  let px = x, py = y;
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    const nx = x + Math.sin(k * 1.4) * lean;
    const ny = y - k * h;
    s.othick(px, py, nx, ny, 4 - k * 1.5, i % 2 ? C.woodSh : C.wood);
    px = nx; py = ny;
  }
  // Gentle breeze: slow period, at most ~1px at the frond tips, and only the outer half of each
  // frond moves. The curl direction is fixed per frond (it used to be derived from the swaying
  // angle, which made the near-vertical frond flip sides whenever the sway crossed a threshold).
  const sway = Math.sin(t * 0.018 + seed * 1.7);
  const fronds = [-2.7, -2.2, -1.5, -0.9, -0.4, 0.3];
  for (const a0 of fronds) {
    const curl = a0 < -1.57 ? -1 : 1;
    let fx = px, fy = py;
    for (let k = 1; k <= 7; k++) {
      const ang = a0 + k * 0.12 * curl;
      const droop = k > 3 ? sway * 0.18 * (k - 3) : 0;
      const nx = fx + Math.cos(ang) * 3;
      const ny = fy + Math.sin(ang) * 3 + k * 0.6 + droop * 0.35;
      s.othick(fx, fy, nx, ny, k < 5 ? 3 : 2, k % 2 ? C.leaf : C.leafSh);
      fx = nx; fy = ny;
    }
  }
  s.odisc(px, py + 2, 2, C.woodSh);
  s.odisc(px + 3, py + 3, 2, C.wood);
}

export function flag(s: Surface, x: number, y: number, t: number, col: number, col2: number, w = 16) {
  s.othick(x, y, x, y + 34, 1, C.steelSh);
  for (let i = 0; i < w; i++) {
    const wy = Math.round(Math.sin(i * 0.5 - t * 0.2) * 1.5 * (i / w));
    s.rect(x + 1 + i, y + 1 + wy, 1, 9, i % 4 < 2 ? col : col2);
    s.pset(x + 1 + i, y + wy, OUTLINE);
    s.pset(x + 1 + i, y + 10 + wy, OUTLINE);
  }
}

export const SKY = {
  dawn: [hex('#f7b58a'), hex('#f6c9a0'), hex('#dfe0c0'), hex('#a8d8d8'), hex('#8ccad8')].reverse(),
  day: [hex('#3a7fd0'), hex('#5a9ae0'), hex('#86b8ec'), hex('#b4d4f0'), hex('#e0ecf0')],
  dusk: [hex('#2a1e48'), hex('#4a2c5c'), hex('#8c3c5c'), hex('#d8604a'), hex('#f0a050')],
  storm: [hex('#1a1628'), hex('#2a2238'), hex('#3c2c44'), hex('#5a3a4a'), hex('#8a4a48')],
};

export { mix, rgb };
