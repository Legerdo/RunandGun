// Software pixel renderer. Every pixel on screen is written by this module, which keeps
// the game crisp at any scale and lets us do per-pixel tricks (flash, dither fades, glow).

export const rgb = (r: number, g: number, b: number): number =>
  (0xff000000 | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;

export const hex = (s: string): number => {
  const n = parseInt(s.replace('#', ''), 16);
  return rgb((n >> 16) & 255, (n >> 8) & 255, n & 255);
};

export const cR = (c: number) => c & 255;
export const cG = (c: number) => (c >>> 8) & 255;
export const cB = (c: number) => (c >>> 16) & 255;

export function mix(a: number, b: number, t: number): number {
  const it = 1 - t;
  return rgb(cR(a) * it + cR(b) * t, cG(a) * it + cG(b) * t, cB(a) * it + cB(b) * t);
}

export function shade(c: number, f: number): number {
  return rgb(Math.min(255, cR(c) * f), Math.min(255, cG(c) * f), Math.min(255, cB(c) * f));
}

// 4x4 Bayer matrix, used for pixel-art style transparency.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
export const bayer = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)];

export const enum Mode {
  Normal = 0,
  Flash = 1, // every opaque pixel becomes `color`
  Tint = 2, // lerp toward `color` by `amount`
  Dither = 3, // ordered-dither alpha by `amount`
}

export interface BlitOpts {
  flip?: boolean;
  mode?: Mode;
  color?: number;
  amount?: number;
}

export const OUTLINE = rgb(22, 16, 24);

export class Surface {
  readonly w: number;
  readonly h: number;
  readonly px: Uint32Array;
  // Optional draw offset (camera). All primitives subtract it.
  ox = 0;
  oy = 0;

  constructor(w: number, h: number, px?: Uint32Array) {
    this.w = w;
    this.h = h;
    this.px = px ?? new Uint32Array(w * h);
  }

  clear(c = 0) {
    this.px.fill(c);
  }

  pset(x: number, y: number, c: number) {
    x = (x - this.ox) | 0;
    y = (y - this.oy) | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px[y * this.w + x] = c;
  }

  pget(x: number, y: number): number {
    x = (x - this.ox) | 0;
    y = (y - this.oy) | 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }

  rect(x: number, y: number, w: number, h: number, c: number) {
    let x0 = Math.floor(x - this.ox);
    let y0 = Math.floor(y - this.oy);
    let x1 = x0 + Math.floor(w);
    let y1 = y0 + Math.floor(h);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.w) x1 = this.w;
    if (y1 > this.h) y1 = this.h;
    if (x0 >= x1 || y0 >= y1) return;
    const px = this.px;
    const W = this.w;
    for (let yy = y0; yy < y1; yy++) px.fill(c, yy * W + x0, yy * W + x1);
  }

  // Ordered-dither translucent rect: alpha 0..1
  drect(x: number, y: number, w: number, h: number, c: number, alpha: number) {
    if (alpha <= 0) return;
    if (alpha >= 1) return this.rect(x, y, w, h, c);
    let x0 = Math.floor(x - this.ox);
    let y0 = Math.floor(y - this.oy);
    let x1 = x0 + Math.floor(w);
    let y1 = y0 + Math.floor(h);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.w) x1 = this.w;
    if (y1 > this.h) y1 = this.h;
    const px = this.px;
    const W = this.w;
    for (let yy = y0; yy < y1; yy++)
      for (let xx = x0; xx < x1; xx++) if (bayer(xx, yy) < alpha) px[yy * W + xx] = c;
  }

  // True alpha blend rect (used for full-screen fades / flashes).
  brect(x: number, y: number, w: number, h: number, c: number, alpha: number) {
    if (alpha <= 0) return;
    let x0 = Math.floor(x - this.ox);
    let y0 = Math.floor(y - this.oy);
    let x1 = x0 + Math.floor(w);
    let y1 = y0 + Math.floor(h);
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 > this.w) x1 = this.w;
    if (y1 > this.h) y1 = this.h;
    const a = Math.min(1, alpha);
    const ia = 1 - a;
    const r = cR(c) * a, g = cG(c) * a, b = cB(c) * a;
    const px = this.px;
    const W = this.w;
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = yy * W + xx;
        const d = px[i];
        px[i] = (0xff000000 | (((cB(d) * ia + b) & 255) << 16) | (((cG(d) * ia + g) & 255) << 8) | ((cR(d) * ia + r) & 255)) >>> 0;
      }
    }
  }

  hline(x0: number, x1: number, y: number, c: number) {
    if (x1 < x0) [x0, x1] = [x1, x0];
    this.rect(x0, y, x1 - x0 + 1, 1, c);
  }

  vline(x: number, y0: number, y1: number, c: number) {
    if (y1 < y0) [y0, y1] = [y1, y0];
    this.rect(x, y0, 1, y1 - y0 + 1, c);
  }

  line(x0: number, y0: number, x1: number, y1: number, c: number) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      this.pset(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  // Thick line made of square stamps; t = thickness in pixels.
  thick(x0: number, y0: number, x1: number, y1: number, t: number, c: number) {
    if (t <= 1) return this.line(x0, y0, x1, y1, c);
    const h = Math.floor(t / 2);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 2000; n++) {
      this.rect(x0 - h, y0 - h, t, t, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  disc(cx: number, cy: number, r: number, c: number) {
    cx = Math.round(cx); cy = Math.round(cy);
    if (r < 0.5) return this.pset(cx, cy, c);
    const rr = r * r + r * 0.8;
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++) {
      const span = Math.floor(Math.sqrt(Math.max(0, rr - y * y)));
      if (y * y > rr) continue;
      this.rect(cx - span, cy + y, span * 2 + 1, 1, c);
    }
  }

  // Dithered translucent disc.
  ddisc(cx: number, cy: number, r: number, c: number, alpha: number) {
    if (alpha <= 0 || r < 0.5) return;
    cx = Math.round(cx); cy = Math.round(cy);
    const rr = r * r + r * 0.8;
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++) {
      if (y * y > rr) continue;
      const span = Math.floor(Math.sqrt(Math.max(0, rr - y * y)));
      for (let x = -span; x <= span; x++) {
        const sx = cx + x - this.ox, sy = cy + y - this.oy;
        if (sx < 0 || sy < 0 || sx >= this.w || sy >= this.h) continue;
        if (bayer(sx, sy) < alpha) this.px[sy * this.w + sx] = c;
      }
    }
  }

  ring(cx: number, cy: number, r: number, c: number, t = 1) {
    cx = Math.round(cx); cy = Math.round(cy);
    const ro = r * r + r;
    const ri = Math.max(0, (r - t) * (r - t) + (r - t));
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        const d = x * x + y * y;
        if (d <= ro && d > ri) this.pset(cx + x, cy + y, c);
      }
  }

  // Outlined primitives: outline first, then fill; later parts overwrite earlier ones,
  // which produces the dark internal separation lines typical of arcade sprites.
  orect(x: number, y: number, w: number, h: number, c: number, o = OUTLINE) {
    this.rect(x - 1, y - 1, w + 2, h + 2, o);
    this.rect(x, y, w, h, c);
  }

  othick(x0: number, y0: number, x1: number, y1: number, t: number, c: number, o = OUTLINE) {
    this.thick(x0, y0, x1, y1, t + 2, o);
    this.thick(x0, y0, x1, y1, t, c);
  }

  odisc(cx: number, cy: number, r: number, c: number, o = OUTLINE) {
    this.disc(cx, cy, r + 1, o);
    this.disc(cx, cy, r, c);
  }

  // Additive light: brightens pixels around a point. Used for muzzle flashes and explosions.
  glow(cx: number, cy: number, r: number, cr: number, cg: number, cb: number) {
    const x0 = Math.max(0, Math.floor(cx - r - this.ox));
    const x1 = Math.min(this.w - 1, Math.ceil(cx + r - this.ox));
    const y0 = Math.max(0, Math.floor(cy - r - this.oy));
    const y1 = Math.min(this.h - 1, Math.ceil(cy + r - this.oy));
    const lcx = cx - this.ox, lcy = cy - this.oy;
    const inv = 1 / (r * r);
    const px = this.px;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - lcx, dy = y - lcy;
        let f = 1 - (dx * dx + dy * dy) * inv;
        if (f <= 0) continue;
        f *= f;
        // quantize to 4 steps so the light itself stays "pixel art"
        f = Math.ceil(f * 4 + bayer(x, y) - 0.5) / 4;
        if (f <= 0) continue;
        const i = y * this.w + x;
        const d = px[i];
        const r2 = Math.min(255, cR(d) + cr * f);
        const g2 = Math.min(255, cG(d) + cg * f);
        const b2 = Math.min(255, cB(d) + cb * f);
        px[i] = (0xff000000 | (b2 << 16) | (g2 << 8) | r2) >>> 0;
      }
    }
  }

  // Copy another surface. (ox,oy) of `this` applies (world-space blit).
  blit(src: Surface, dx: number, dy: number, o?: BlitOpts) {
    const flip = o?.flip ?? false;
    const mode = o?.mode ?? Mode.Normal;
    const color = o?.color ?? 0xffffffff;
    const amount = o?.amount ?? 1;
    dx = Math.round(dx - this.ox);
    dy = Math.round(dy - this.oy);
    const sw = src.w, sh = src.h, spx = src.px;
    const W = this.w, H = this.h, px = this.px;
    const xs = Math.max(0, -dx), xe = Math.min(sw, W - dx);
    const ys = Math.max(0, -dy), ye = Math.min(sh, H - dy);
    if (xs >= xe || ys >= ye) return;
    const tr = cR(color), tg = cG(color), tb = cB(color);
    for (let y = ys; y < ye; y++) {
      const drow = (dy + y) * W + dx;
      const srow = y * sw;
      for (let x = xs; x < xe; x++) {
        const c = spx[srow + (flip ? sw - 1 - x : x)];
        if (c === 0) continue;
        const di = drow + x;
        if (mode === Mode.Normal) px[di] = c;
        else if (mode === Mode.Flash) px[di] = color;
        else if (mode === Mode.Tint) {
          const ia = 1 - amount;
          px[di] = (0xff000000 | (((cB(c) * ia + tb * amount) & 255) << 16) | (((cG(c) * ia + tg * amount) & 255) << 8) | ((cR(c) * ia + tr * amount) & 255)) >>> 0;
        } else if (mode === Mode.Dither) {
          if (bayer(dx + x, dy + y) < amount) px[di] = c;
        }
      }
    }
  }

  // Nearest-neighbour rotated blit around (px,py) inside src, placed at world (cx,cy).
  blitRot(src: Surface, pivX: number, pivY: number, cx: number, cy: number, ang: number, o?: BlitOpts) {
    if (Math.abs(ang) < 0.001 && !(o?.flip)) return this.blit(src, cx - pivX, cy - pivY, o);
    const flip = o?.flip ?? false;
    const mode = o?.mode ?? Mode.Normal;
    const color = o?.color ?? 0xffffffff;
    const amount = o?.amount ?? 1;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const R = Math.ceil(Math.hypot(Math.max(pivX, src.w - pivX), Math.max(pivY, src.h - pivY)));
    const lcx = Math.round(cx - this.ox), lcy = Math.round(cy - this.oy);
    const sw = src.w, sh = src.h, spx = src.px;
    for (let y = -R; y <= R; y++) {
      const ty = lcy + y;
      if (ty < 0 || ty >= this.h) continue;
      for (let x = -R; x <= R; x++) {
        const tx = lcx + x;
        if (tx < 0 || tx >= this.w) continue;
        // inverse rotate
        let sx = x * ca + y * sa;
        const sy = -x * sa + y * ca;
        if (flip) sx = -sx;
        const ix = Math.floor(sx + pivX + 0.5), iy = Math.floor(sy + pivY + 0.5);
        if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) continue;
        const c = spx[iy * sw + ix];
        if (c === 0) continue;
        const di = ty * this.w + tx;
        if (mode === Mode.Normal) this.px[di] = c;
        else if (mode === Mode.Flash) this.px[di] = color;
        else if (mode === Mode.Tint) this.px[di] = mix(c, color, amount);
        else if (mode === Mode.Dither) { if (bayer(tx, ty) < amount) this.px[di] = c; }
      }
    }
  }

  // Draw a surface with a 1px outline around its silhouette.
  blitOutlined(src: Surface, dx: number, dy: number, o?: BlitOpts, oc = OUTLINE) {
    const flip = o?.flip ?? false;
    const sw = src.w, sh = src.h, spx = src.px;
    const bx = Math.round(dx), by = Math.round(dy);
    for (let y = 0; y < sh; y++)
      for (let x = 0; x < sw; x++) {
        if (spx[y * sw + x] === 0) continue;
        const X = bx + (flip ? sw - 1 - x : x), Y = by + y;
        if (x === 0 || spx[y * sw + x - 1] === 0) this.pset(flip ? X + 1 : X - 1, Y, oc);
        if (x === sw - 1 || spx[y * sw + x + 1] === 0) this.pset(flip ? X - 1 : X + 1, Y, oc);
        if (y === 0 || spx[(y - 1) * sw + x] === 0) this.pset(X, Y - 1, oc);
        if (y === sh - 1 || spx[(y + 1) * sw + x] === 0) this.pset(X, Y + 1, oc);
      }
    this.blit(src, dx, dy, o);
  }
}

// Build a sprite from rows of characters. '.' or ' ' = transparent.
export function fromRows(rows: string[], pal: Record<string, number>): Surface {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const s = new Surface(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < rows[y].length; x++) {
      const ch = rows[y][x];
      if (ch === '.' || ch === ' ') continue;
      const c = pal[ch];
      if (c !== undefined) s.px[y * w + x] = c;
    }
  return s;
}
