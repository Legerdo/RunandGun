import { Surface, bayer, mix, OUTLINE } from '../engine/surface';
import { drawText } from '../engine/font';
import { C } from './palette';
import type { Game } from './world';

export const enum PT {
  Spark, Smoke, Fire, Debris, Chunk, Shell, Dust, Ring, Star, Text, Drop, Ember, Light, Streak, Flame, Steam, Leaf, Paper,
}

export interface Particle {
  t: PT;
  x: number; y: number; vx: number; vy: number;
  life: number; max: number;
  size: number; size2: number;
  c: number; c2: number;
  rot: number; vr: number;
  grav: number; drag: number;
  bounce: number; bounced: number;
  str?: string;
  front?: boolean;
  seed: number;
}

interface Lobe { ox: number; oy: number; r: number; delay: number; vx: number; vy: number; hot: number }
interface Boom { x: number; y: number; age: number; lobes: Lobe[]; scale: number; dur: number }

export interface Decal { x: number; y: number; kind: 'scorch' | 'hole' | 'crater' | 'splat'; r: number; seed: number }

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class FX {
  ps: Particle[] = [];
  booms: Boom[] = [];
  decals: Decal[] = [];
  lights: { x: number; y: number; r: number; c: [number, number, number]; life: number; max: number }[] = [];

  clear() {
    this.ps.length = 0;
    this.booms.length = 0;
    this.decals.length = 0;
    this.lights.length = 0;
  }

  add(p: Partial<Particle> & { t: PT; x: number; y: number }): Particle {
    const q: Particle = {
      vx: 0, vy: 0, life: 20, max: 20, size: 1, size2: 0, c: C.white, c2: C.white, rot: 0, vr: 0, grav: 0, drag: 1, bounce: 0, bounced: 0, seed: Math.random() * 1000,
      ...p,
    } as Particle;
    q.max = q.life;
    if (this.ps.length > 900) this.ps.shift();
    this.ps.push(q);
    return q;
  }

  light(x: number, y: number, r: number, c: [number, number, number], life: number) {
    this.lights.push({ x, y, r, c, life, max: life });
  }

  // ------------------------------------------------ spawners
  sparks(x: number, y: number, n: number, dir: number, spread: number, spd: number, c = C.spark) {
    for (let i = 0; i < n; i++) {
      const a = dir + rand(-spread, spread);
      const v = spd * rand(0.4, 1.2);
      this.add({ t: PT.Spark, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(5, 12) | 0, c, grav: 0.12, drag: 0.9 });
    }
  }

  smoke(x: number, y: number, n: number, r: number, c = C.smoke1, rise = 0.4) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Smoke, x: x + rand(-r, r) * 0.5, y: y + rand(-r, r) * 0.5, vx: rand(-0.3, 0.3), vy: -rand(0.1, rise), life: rand(30, 60) | 0, size: rand(r * 0.4, r * 0.8), size2: r * rand(1, 1.6), c, drag: 0.97 });
    }
  }

  dust(x: number, y: number, n: number, dir = 0, c = C.sandSh) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Dust, x: x + rand(-3, 3), y: y - rand(0, 2), vx: dir * rand(0.2, 1.2) + rand(-0.5, 0.5), vy: -rand(0.05, 0.5), life: rand(14, 26) | 0, size: rand(1.5, 3), size2: rand(3, 5), c, drag: 0.92 });
    }
  }

  debris(x: number, y: number, n: number, c: number, spd = 3, up = 3, size = 2) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Debris, x, y, vx: rand(-spd, spd), vy: -rand(1, up) - 0.5, life: rand(40, 80) | 0, size: rand(1, size + 0.99) | 0, c, grav: 0.2, drag: 0.99, bounce: 0.4, rot: Math.random() * 6 });
    }
  }

  // Bigger outlined fragments (planks, plates, bricks) that tumble.
  chunks(x: number, y: number, n: number, c: number, c2: number, len = 6, thick = 2, spd = 3, up = 4) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Chunk, x: x + rand(-4, 4), y: y + rand(-4, 4), vx: rand(-spd, spd), vy: -rand(1.5, up), life: rand(60, 110) | 0, size: rand(len * 0.6, len * 1.2), size2: thick, c, c2, grav: 0.22, drag: 0.995, bounce: 0.35, rot: Math.random() * 6, vr: rand(-0.4, 0.4) });
    }
  }

  shell(x: number, y: number, dir: number, big = false) {
    this.add({ t: PT.Shell, x, y, vx: -dir * rand(0.6, 1.6), vy: -rand(1.6, 2.8), life: 50, size: big ? 3 : 2, c: C.brass, c2: C.brassSh, grav: 0.22, bounce: 0.45, rot: 0, vr: rand(0.3, 0.6) });
  }

  ring(x: number, y: number, r0: number, r1: number, life: number, c = C.white) {
    this.add({ t: PT.Ring, x, y, size: r0, size2: r1, life, c });
  }

  star(x: number, y: number, r: number, life = 4, c = C.white) {
    this.add({ t: PT.Star, x, y, size: r, life, c, rot: Math.random() * Math.PI });
  }

  text(x: number, y: number, str: string, c = C.hud) {
    this.add({ t: PT.Text, x, y, vy: -0.6, life: 50, str, c, drag: 0.94, front: true });
  }

  splash(x: number, y: number, n: number, pow = 1) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Drop, x: x + rand(-6, 6) * pow, y, vx: rand(-1.2, 1.2) * pow, vy: -rand(2, 5) * pow, life: rand(30, 60) | 0, size: rand(1, 2.99) | 0, c: Math.random() < 0.4 ? C.waterHi : C.water, grav: 0.2 });
    }
  }

  embers(x: number, y: number, n: number, spread = 8) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Ember, x: x + rand(-spread, spread), y: y + rand(-spread, spread) * 0.5, vx: rand(-0.4, 0.4), vy: -rand(0.3, 1.2), life: rand(20, 50) | 0, c: Math.random() < 0.5 ? C.fire2 : C.fire3, drag: 0.98 });
    }
  }

  steam(x: number, y: number, n: number, vx: number, vy: number) {
    for (let i = 0; i < n; i++) {
      this.add({ t: PT.Steam, x: x + rand(-2, 2), y: y + rand(-2, 2), vx: vx * rand(0.7, 1.3) + rand(-0.3, 0.3), vy: vy * rand(0.7, 1.3) + rand(-0.3, 0.3), life: rand(16, 30) | 0, size: rand(1.5, 3), size2: rand(5, 9), c: C.steam, drag: 0.93 });
    }
  }

  // Hand-built explosion "flipbook": clustered lobes that heat up, bloom and cool to smoke.
  boom(x: number, y: number, scale: number) {
    const n = Math.round(5 + scale * 4);
    const lobes: Lobe[] = [];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * 7 * scale;
      lobes.push({
        ox: Math.cos(a) * d,
        oy: Math.sin(a) * d * 0.8 - (i > n / 2 ? 4 * scale : 0),
        r: (4 + Math.random() * 4) * scale * (i === 0 ? 1.4 : 1),
        delay: i === 0 ? 0 : Math.floor(Math.random() * 5 * Math.min(2, scale)),
        vx: Math.cos(a) * 0.25 * scale,
        vy: -0.25 - Math.random() * 0.5 * scale,
        hot: Math.random(),
      });
    }
    this.booms.push({ x, y, age: 0, lobes, scale, dur: 26 + scale * 6 });
  }

  update(g: Game) {
    const ps = this.ps;
    let w = 0;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.life--;
      if (p.life <= 0) continue;
      p.vy += p.grav;
      p.vx *= p.drag;
      p.vy *= p.drag;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      if (p.bounce > 0) {
        const gy = g.groundAt(p.x, p.y - 6);
        if (p.y >= gy && p.vy > 0) {
          p.y = gy;
          if (Math.abs(p.vy) > 0.8) {
            if (p.t === PT.Shell && p.bounced === 0) g.snd('shell', p.x, 0.35);
            p.vy = -p.vy * p.bounce;
            p.vx *= 0.7;
            p.vr *= 0.6;
            p.bounced++;
          } else {
            p.vy = 0;
            p.vx *= 0.8;
            p.vr = 0;
          }
        }
      }
      if (p.t === PT.Fire && Math.random() < 0.08) this.add({ t: PT.Smoke, x: p.x, y: p.y, vy: -0.3, life: 30, size: p.size * 0.6, size2: p.size * 1.4, c: C.smoke1, drag: 0.97 });
      ps[w++] = p;
    }
    ps.length = w;

    for (const b of this.booms) b.age++;
    this.booms = this.booms.filter((b) => b.age < b.dur + 30);
    for (const l of this.lights) l.life--;
    this.lights = this.lights.filter((l) => l.life > 0);
    if (this.decals.length > 160) this.decals.splice(0, this.decals.length - 160);
  }

  drawDecals(s: Surface) {
    for (const d of this.decals) {
      if (d.x < s.ox - 40 || d.x > s.ox + s.w + 40) continue;
      if (d.kind === 'scorch' || d.kind === 'crater') {
        const r = d.r;
        for (let yy = -2; yy <= 2; yy++) {
          const span = Math.floor(r * Math.sqrt(1 - (yy / 3) * (yy / 3)));
          for (let xx = -span; xx <= span; xx++) {
            const edge = Math.abs(xx) / (span + 1);
            const X = Math.round(d.x + xx), Y = Math.round(d.y + yy);
            if (bayer(X, Y) < 0.9 - edge * 0.8) s.pset(X, Y, d.kind === 'crater' ? C.black : mix(s.pget(X, Y), C.black, 0.55));
          }
        }
      } else if (d.kind === 'hole') {
        s.pset(d.x, d.y, C.black);
        if (d.seed > 500) s.pset(d.x + 1, d.y, C.stoneDk);
      }
    }
  }

  drawBooms(s: Surface) {
    for (const b of this.booms) {
      // draw back-to-front: cooler (older) lobes first
      for (let pass = 0; pass < 2; pass++) {
        for (const l of b.lobes) {
          const a = b.age - l.delay;
          if (a < 0) continue;
          const la = a / b.dur;
          const smoke = la > 0.45;
          if ((pass === 0) !== smoke) continue;
          const grow = Math.min(1, a / 5);
          const r = l.r * (0.35 + 0.65 * (1 - Math.pow(1 - grow, 3))) * (smoke ? 1 + (la - 0.45) * 0.8 : 1);
          const x = b.x + l.ox + l.vx * a;
          const y = b.y + l.oy + l.vy * a * (smoke ? 1.4 : 1);
          if (a < 2) {
            s.disc(x, y, r + 1, C.white);
            continue;
          }
          if (!smoke) {
            const heat = 1 - la / 0.45; // 1 -> 0
            const rim = heat > 0.6 ? C.fire3 : heat > 0.3 ? C.fire4 : C.fire5;
            const body = heat > 0.7 ? C.fire1 : heat > 0.4 ? C.fire2 : C.fire3;
            const core = heat > 0.5 ? C.white : C.fire1;
            s.disc(x, y, r + 1, OUTLINE);
            s.disc(x, y, r, rim);
            s.disc(x - r * 0.15, y - r * 0.2, r * 0.75, body);
            if (heat > 0.25) s.disc(x - r * 0.25, y - r * 0.3, r * 0.4 * heat + 0.5, core);
          } else {
            const fade = 1 - (la - 0.45) / 0.9;
            if (fade <= 0) continue;
            const col = la < 0.6 ? C.smoke2 : C.smoke1;
            s.ddisc(x, y, r, col, Math.min(1, fade * 1.4));
            s.ddisc(x - r * 0.25, y - r * 0.3, r * 0.55, la < 0.6 ? C.fire5 : C.smoke0, fade * 0.9);
          }
        }
      }
    }
  }

  draw(s: Surface, front: boolean) {
    for (const p of this.ps) {
      if (!!p.front !== front) continue;
      if (p.x < s.ox - 30 || p.x > s.ox + s.w + 30 || p.y < s.oy - 60 || p.y > s.oy + s.h + 30) continue;
      const k = p.life / p.max; // 1 -> 0
      switch (p.t) {
        case PT.Spark: {
          s.line(p.x, p.y, p.x - p.vx * 1.5, p.y - p.vy * 1.5, k > 0.5 ? C.white : p.c);
          break;
        }
        case PT.Streak: {
          s.line(p.x, p.y, p.x - p.vx * 3, p.y - p.vy * 3, p.c);
          break;
        }
        case PT.Smoke: {
          const r = p.size + (p.size2 - p.size) * (1 - k);
          s.ddisc(p.x, p.y, r, p.c, k * 0.9);
          break;
        }
        case PT.Steam: {
          const r = p.size + (p.size2 - p.size) * (1 - k);
          s.ddisc(p.x, p.y, r, p.c, k * 0.8);
          break;
        }
        case PT.Dust: {
          const r = p.size + (p.size2 - p.size) * (1 - k);
          s.ddisc(p.x, p.y, r, p.c, k * 0.85);
          break;
        }
        case PT.Fire:
        case PT.Flame: {
          const r = Math.max(0.5, p.size * (0.4 + 0.6 * k) + (p.t === PT.Flame ? (1 - k) * p.size2 : 0));
          const col = k > 0.8 ? C.fire1 : k > 0.55 ? C.fire2 : k > 0.3 ? C.fire3 : C.fire4;
          s.disc(p.x, p.y, r + 1, k > 0.3 ? C.fire4 : C.fire5);
          s.disc(p.x, p.y, r, col);
          if (k > 0.5) s.disc(p.x - 1, p.y - 1, r * 0.45, C.fire1);
          break;
        }
        case PT.Ember: {
          if ((p.life & 3) !== 0 || k > 0.3) s.pset(p.x, p.y, p.c);
          break;
        }
        case PT.Debris: {
          if (k < 0.25 && (p.life & 2)) break;
          const sz = p.size;
          s.rect(p.x - (sz >> 1), p.y - sz, sz, sz, p.c);
          break;
        }
        case PT.Chunk: {
          if (k < 0.2 && (p.life & 2)) break;
          const L = p.size / 2;
          const ca = Math.cos(p.rot) * L, sa = Math.sin(p.rot) * L;
          s.othick(p.x - ca, p.y - sa - 1, p.x + ca, p.y + sa - 1, p.size2, p.c);
          s.pset(p.x - ca * 0.5, p.y - sa * 0.5 - 1, p.c2);
          break;
        }
        case PT.Shell: {
          if (k < 0.2 && (p.life & 2)) break;
          const horiz = Math.floor(p.rot * 2) % 2 === 0;
          s.rect(p.x, p.y - 1, horiz ? p.size : 1, horiz ? 1 : p.size, p.c);
          s.pset(p.x, p.y - 1, p.c2);
          break;
        }
        case PT.Ring: {
          const r = p.size + (p.size2 - p.size) * (1 - k * k);
          s.ring(p.x, p.y, r, k > 0.5 ? C.white : p.c, k > 0.5 ? 2 : 1);
          break;
        }
        case PT.Star: {
          const r = p.size * (0.5 + k * 0.5);
          for (let i = 0; i < 4; i++) {
            const a = p.rot + (i * Math.PI) / 4;
            const L = i % 2 === 0 ? r : r * 0.55;
            s.thick(p.x - Math.cos(a) * L, p.y - Math.sin(a) * L, p.x + Math.cos(a) * L, p.y + Math.sin(a) * L, 1, p.c);
          }
          s.disc(p.x, p.y, r * 0.3, C.white);
          break;
        }
        case PT.Text: {
          if (k < 0.3 && (p.life & 2)) break;
          drawText(s, p.str ?? '', p.x, p.y, p.c, { align: 'center' });
          break;
        }
        case PT.Drop: {
          s.rect(p.x, p.y, p.size, p.size + (p.vy > 1 ? 1 : 0), p.c);
          break;
        }
        case PT.Leaf:
        case PT.Paper: {
          const f = Math.floor(p.rot) % 2 === 0;
          s.rect(p.x, p.y, f ? 2 : 1, f ? 1 : 2, p.c);
          break;
        }
        case PT.Light:
          break;
      }
    }
  }

  drawLights(s: Surface) {
    for (const l of this.lights) {
      const k = l.life / l.max;
      s.glow(l.x, l.y, l.r * (0.6 + 0.4 * k), l.c[0] * k, l.c[1] * k, l.c[2] * k);
    }
  }
}
