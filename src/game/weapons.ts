import { Surface, OUTLINE } from '../engine/surface';
import { C } from './palette';
import { Ent, type DmgKind, type Hit, type Mat, type Rect } from './types';
import { PT } from './fx';
import { groundZone } from './danger';
import type { Game } from './world';

export type WeaponId = 'pistol' | 'gat' | 'scatter' | 'rocket' | 'flame';

export const WEAPONS: Record<WeaponId, { name: string; ammo: number; letter: string; color: number; voice: string }> = {
  pistol: { name: 'PISTOL', ammo: 0, letter: '', color: C.white, voice: '' },
  gat: { name: 'CHAIN GUN', ammo: 200, letter: 'C', color: C.fire2, voice: 'w_gatling' },
  scatter: { name: 'SCATTER CANNON', ammo: 30, letter: 'S', color: C.red, voice: 'w_scatter' },
  rocket: { name: 'BOOMER ROCKETS', ammo: 30, letter: 'R', color: C.green, voice: 'w_rocket' },
  flame: { name: 'FLAMETHROWER', ammo: 160, letter: 'F', color: C.blue, voice: 'w_flame' },
};

// Visual + audio response for a projectile impact, chosen by material.
export function impact(g: Game, x: number, y: number, mat: Mat | 'solid', dx: number, dy: number, heavy = false) {
  const back = Math.atan2(-dy, -dx);
  switch (mat) {
    case 'flesh':
      g.fx.star(x, y, heavy ? 6 : 4, 3, C.white);
      g.fx.sparks(x, y, heavy ? 4 : 2, back, 0.9, 2.2, C.fire1);
      g.fx.add({ t: PT.Dust, x, y, vx: dx * 0.3, vy: -0.2, life: 10, size: 1.5, size2: 3.5, c: C.offwhite });
      g.snd(heavy ? 'hitheavy' : 'hit', x, heavy ? 0.7 : 0.5);
      break;
    case 'metal':
      g.fx.sparks(x, y, heavy ? 7 : 4, back, 0.8, 3.5, C.metalSpark);
      g.fx.star(x, y, heavy ? 5 : 3, 2, C.metalSpark);
      g.snd(Math.random() < 0.5 ? 'ping' : 'clank', x, heavy ? 0.45 : 0.35);
      break;
    case 'wood':
      g.fx.debris(x, y, heavy ? 4 : 2, C.woodHi, 1.5, 2, 2);
      g.fx.add({ t: PT.Dust, x, y, vx: -dx * 0.4, life: 12, size: 1.5, size2: 3, c: C.woodSh });
      g.snd('wood', x, 0.25, 1.4);
      break;
    case 'sand':
      g.fx.dust(x, y, heavy ? 4 : 2, -dx, C.sandSh);
      g.fx.debris(x, y, 2, C.sand, 1, 2, 1);
      g.snd('sand', x, 0.4);
      break;
    case 'glass':
      g.fx.debris(x, y, 5, C.glass, 1.5, 2, 1);
      g.snd('glass', x, 0.4);
      break;
    default:
      g.fx.sparks(x, y, 2, back, 0.9, 2, C.spark);
      g.fx.add({ t: PT.Dust, x, y, vx: -dx * 0.3, vy: -0.2, life: 12, size: 1, size2: 3, c: C.stoneSh });
      if (Math.random() < 0.5) g.fx.decals.push({ x: Math.round(x), y: Math.round(y), kind: 'hole', r: 1, seed: Math.random() * 1000 });
      g.snd('sand', x, 0.25, 1.6);
  }
}

// Point-vs-entities test used by all player projectiles.
function hitEnts(g: Game, self: Ent, x: number, y: number, pad: number, h: Hit, skip?: Set<Ent>): { e: Ent; mat: Mat } | null {
  for (const e of g.ents) {
    if (e.dead || !e.hittable || e.team === 'player' || e === self) continue;
    if (skip && skip.has(e)) continue;
    const b = e.box();
    if (!b) continue;
    if (x >= b.x - pad && x < b.x + b.w + pad && y >= b.y - pad && y < b.y + b.h + pad) {
      const mat = e.onHit(g, h);
      if (mat) return { e, mat };
    }
  }
  return null;
}

// ------------------------------------------------------------------ player bullets
export class PBullet extends Ent {
  kind: 'pistol' | 'gat' | 'pellet';
  life: number;
  dmg: number;
  constructor(x: number, y: number, vx: number, vy: number, kind: 'pistol' | 'gat' | 'pellet', life = 60) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.kind = kind;
    this.life = life;
    this.team = 'player';
    this.z = 60;
    this.dmg = kind === 'pellet' ? 1.6 : 1;
  }
  update(g: Game) {
    if (--this.life <= 0) {
      if (this.kind === 'pellet') g.fx.add({ t: PT.Dust, x: this.x, y: this.y, life: 8, size: 1, size2: 2, c: C.smoke0 });
      this.dead = true;
      return;
    }
    const steps = 3;
    const kind: DmgKind = this.kind === 'gat' ? 'heavy' : this.kind === 'pellet' ? 'pellet' : 'bullet';
    const sp = Math.hypot(this.vx, this.vy);
    const first = this.age === 1;
    for (let i = first ? -1 : 0; i < steps; i++) {
      // on the first frame also test the muzzle point itself (point-blank shots)
      if (i >= 0) {
        this.x += this.vx / steps;
        this.y += this.vy / steps;
      }
      const h: Hit = { dmg: this.dmg, kind, x: this.x, y: this.y, dx: this.vx / sp, dy: this.vy / sp, force: this.kind === 'pellet' ? 2.2 : this.kind === 'gat' ? 0.9 : 0.5, from: 'player' };
      const r = hitEnts(g, this, this.x, this.y, this.kind === 'pellet' ? 3 : 1, h);
      if (r) {
        g.hits++;
        impact(g, this.x, this.y, r.mat, h.dx, h.dy, this.kind !== 'pistol');
        this.dead = true;
        return;
      }
      if (g.solidAt(this.x, this.y)) {
        impact(g, this.x, this.y, g.stage.matAt(g, this.x, this.y), h.dx, h.dy);
        this.dead = true;
        return;
      }
    }
    if (!g.onScreen(this.x, 16) || this.y < g.cam.y - 30 || this.y > g.cam.y + 240) this.dead = true;
  }
  draw(_g: Game, s: Surface) {
    const sp = Math.hypot(this.vx, this.vy) || 1;
    const dx = this.vx / sp, dy = this.vy / sp;
    if (this.kind === 'pellet') {
      s.disc(this.x, this.y, 1.5, C.pbulEdge);
      s.pset(this.x, this.y, C.white);
      s.line(this.x, this.y, this.x - dx * 4, this.y - dy * 4, C.pbulEdge);
      return;
    }
    const L = this.kind === 'gat' ? 7 : 5;
    s.thick(this.x - dx * L, this.y - dy * L, this.x, this.y, this.kind === 'gat' ? 3 : 2, C.pbulEdge);
    s.line(this.x - dx * (L - 2), this.y - dy * (L - 2), this.x, this.y, C.pbulCore);
  }
}

export class Rocket extends Ent {
  life = 90;
  spd = 1.5;
  ang: number;
  constructor(x: number, y: number, ang: number) {
    super();
    this.x = x; this.y = y; this.ang = ang;
    this.team = 'player';
    this.z = 60;
  }
  update(g: Game) {
    this.life--;
    this.spd = Math.min(6.5, this.spd + 0.35);
    // gentle homing toward the closest enemy in front
    if (this.age > 6) {
      let best: Ent | null = null, bd = 160;
      for (const e of g.ents) {
        if (e.dead || !e.hittable || e.team !== 'enemy') continue;
        const b = e.box();
        if (!b) continue;
        const ex = b.x + b.w / 2, ey = b.y + b.h / 2;
        const d = Math.hypot(ex - this.x, ey - this.y);
        const a = Math.atan2(ey - this.y, ex - this.x);
        let da = a - this.ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        if (Math.abs(da) < 0.9 && d < bd) { bd = d; best = e; }
      }
      if (best) {
        const b = best.box()!;
        const a = Math.atan2(b.y + b.h / 2 - this.y, b.x + b.w / 2 - this.x);
        let da = a - this.ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        this.ang += Math.max(-0.07, Math.min(0.07, da));
      }
    }
    this.vx = Math.cos(this.ang) * this.spd;
    this.vy = Math.sin(this.ang) * this.spd;
    if (this.age % 2 === 0) g.fx.add({ t: PT.Smoke, x: this.x - this.vx, y: this.y - this.vy, vy: -0.1, life: 26, size: 1.5, size2: 4, c: C.smoke0, drag: 0.95 });
    g.fx.add({ t: PT.Fire, x: this.x - this.vx * 1.2, y: this.y - this.vy * 1.2, life: 5, size: 1.5, c: C.fire2 });
    for (let i = 0; i < 2; i++) {
      this.x += this.vx / 2;
      this.y += this.vy / 2;
      const h: Hit = { dmg: 2, kind: 'rocket', x: this.x, y: this.y, dx: Math.cos(this.ang), dy: Math.sin(this.ang), force: 2, from: 'player' };
      const r = hitEnts(g, this, this.x, this.y, 2, h);
      if (r || g.solidAt(this.x, this.y) || this.life <= 0) {
        if (r) g.hits++;
        this.blow(g);
        return;
      }
    }
    if (!g.onScreen(this.x, 30)) this.dead = true;
  }
  blow(g: Game) {
    this.dead = true;
    g.explode(this.x, this.y, 26, 7, 'player', { scale: 1.2 });
    g.hitstop(2);
  }
  draw(_g: Game, s: Surface) {
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    s.othick(this.x - ca * 6, this.y - sa * 6, this.x, this.y, 3, C.green);
    s.thick(this.x - ca * 2, this.y - sa * 2, this.x, this.y, 2, C.steelHi);
    s.pset(this.x - ca * 5, this.y - sa * 5, C.greenSh);
    s.pset(this.x - ca * 7, this.y - sa * 7, (this.age & 2) ? C.fire1 : C.fire2);
  }
}

export class Grenade extends Ent {
  bounces = 0;
  spin = 0;
  fuse = 110;
  owner: 'player' | 'enemy';
  constructor(x: number, y: number, vx: number, vy: number, owner: 'player' | 'enemy') {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.owner = owner;
    this.team = owner;
    this.z = 55;
  }
  update(g: Game) {
    this.vy += this.owner === 'player' ? 0.24 : 0.16;
    this.spin += this.vx * 0.25;
    this.fuse--;
    const nx = this.x + this.vx, ny = this.y + this.vy;
    // walls
    if (g.solidAt(nx, this.y - 1)) {
      this.vx = -this.vx * 0.5;
    } else this.x = nx;
    const gy = g.groundAt(this.x, this.y - 2);
    if (ny >= gy && this.vy > 0) {
      this.y = gy;
      this.bounces++;
      if (this.owner === 'player' ? this.bounces >= 2 : this.bounces >= 2) return this.blow(g);
      g.snd('tonk', this.x, 0.5);
      g.fx.dust(this.x, this.y, 2);
      this.vy = -this.vy * 0.45;
      this.vx *= 0.6;
    } else this.y = ny;
    if (this.owner === 'player') {
      for (const e of g.ents) {
        if (e.dead || !e.hittable || e.team !== 'enemy') continue;
        const b = e.box();
        if (b && this.x > b.x && this.x < b.x + b.w && this.y > b.y && this.y < b.y + b.h) {
          g.hits++;
          return this.blow(g);
        }
      }
    } else {
      const pb = g.player.box();
      if (pb && this.x > pb.x && this.x < pb.x + pb.w && this.y > pb.y && this.y < pb.y + pb.h) return this.blow(g);
    }
    if (this.fuse <= 0 || this.y > g.cam.y + 400) this.blow(g);
  }
  blow(g: Game) {
    this.dead = true;
    if (this.owner === 'player') {
      g.explode(this.x, this.y - 4, 32, 10, 'player', { scale: 1.3 });
      g.hitstop(3);
    } else {
      g.explode(this.x, this.y - 4, 22, 1, 'enemy', { scale: 1 });
    }
  }
  draw(g: Game, s: Surface) {
    const f = Math.floor(this.spin) & 3;
    if (this.owner === 'player') {
      s.odisc(this.x, this.y - 2, 2, C.vest);
      s.pset(this.x - 1, this.y - 3, C.vestHi);
      const ox = [0, 2, 0, -2][f], oy = [-2, 0, 2, 0][f];
      s.pset(this.x + ox, this.y - 2 + oy, C.brass);
    } else {
      // enemy "tin can" grenade on a stick with a blinking fuse light
      if (this.bounces >= 1) groundZone(s, this.x, 16, g.groundAt(this.x, this.y - 4), g.t, 0.85);
      const ca = Math.cos(this.spin), sa = Math.sin(this.spin);
      s.othick(this.x - ca * 4, this.y - 2 - sa * 4, this.x, this.y - 2, 1, C.woodHi);
      s.odisc(this.x + ca, this.y - 2 + sa, 2, C.tinSh);
      if ((g.t >> 2) & 1) s.pset(this.x + ca, this.y - 3 + sa, C.ebul);
    }
  }
}

export class FlameShot extends Ent {
  life = 30;
  hitSet = new Set<Ent>();
  constructor(x: number, y: number, vx: number, vy: number) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.team = 'player';
    this.z = 61;
  }
  update(g: Game) {
    this.life--;
    this.vx *= 0.95;
    this.vy = this.vy * 0.95 - 0.05;
    this.x += this.vx;
    this.y += this.vy;
    const r = 3 + (30 - this.life) * 0.33;
    const box: Rect = { x: this.x - r, y: this.y - r, w: r * 2, h: r * 2 };
    for (const e of g.ents) {
      if (e.dead || !e.hittable || e.team === 'player' || this.hitSet.has(e)) continue;
      const b = e.box();
      if (!b) continue;
      if (b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) {
        const sp = Math.hypot(this.vx, this.vy) || 1;
        if (e.onHit(g, { dmg: 0.55, kind: 'fire', x: this.x, y: this.y, dx: this.vx / sp, dy: 0, force: 0.2, from: 'player' })) {
          this.hitSet.add(e);
          g.hits++;
          if (Math.random() < 0.3) g.fx.embers(this.x, this.y, 2, 3);
        }
      }
    }
    if (g.solidAt(this.x, this.y)) {
      this.vx *= -0.2;
      this.vy -= 0.4;
    }
    if (this.life % 3 === 0) g.fx.add({ t: PT.Smoke, x: this.x, y: this.y - 2, vy: -0.4, life: 24, size: 2, size2: 5, c: C.smoke1, drag: 0.96 });
    if (this.life <= 0) this.dead = true;
  }
  draw(g: Game, s: Surface) {
    const k = this.life / 30;
    const r = 2 + (1 - k) * 7;
    const col = k > 0.75 ? C.fire1 : k > 0.5 ? C.fire2 : k > 0.25 ? C.fire3 : C.fire4;
    const j = ((g.t + this.x) | 0) & 1;
    s.disc(this.x, this.y + j, r + 1, k > 0.4 ? C.fire3 : C.fire5);
    s.disc(this.x, this.y + j, r, col);
    if (k > 0.3) s.disc(this.x - 1, this.y - 1 + j, r * 0.5, k > 0.6 ? C.white : C.fire1);
  }
}

// ------------------------------------------------------------------ enemy projectiles
export class EBullet extends Ent {
  life = 240;
  size: number;
  constructor(x: number, y: number, vx: number, vy: number, size = 2) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.team = 'enemy';
    this.z = 70;
    this.size = size;
  }
  update(g: Game) {
    this.x += this.vx;
    this.y += this.vy;
    if (--this.life <= 0 || !g.onScreen(this.x, 30)) { this.dead = true; return; }
    if (g.solidAt(this.x, this.y)) {
      this.dead = true;
      g.fx.sparks(this.x, this.y, 3, Math.atan2(-this.vy, -this.vx), 1, 1.5, C.ebul);
      return;
    }
    const pb = g.player.box();
    if (pb && this.x >= pb.x - 1 && this.x <= pb.x + pb.w + 1 && this.y >= pb.y - 1 && this.y <= pb.y + pb.h + 1) {
      if (g.player.hurt(g, this.x)) this.dead = true;
    }
  }
  draw(g: Game, s: Surface) {
    const r = this.size;
    s.disc(this.x, this.y, r + 1, OUTLINE);
    s.disc(this.x, this.y, r, (g.t >> 1) & 1 ? C.ebul : C.ebulEdge);
    s.disc(this.x, this.y, Math.max(0, r - 1.2), C.ebulCore);
  }
}

// Slow rocket fired by enemies. Can be shot down.
export class ERocket extends Ent {
  life = 300;
  spd: number;
  ang: number;
  maxSpd: number;
  constructor(x: number, y: number, ang: number, maxSpd = 3.2) {
    super();
    this.x = x; this.y = y; this.ang = ang;
    this.team = 'enemy';
    this.hittable = true;
    this.z = 70;
    this.spd = 0.8;
    this.maxSpd = maxSpd;
    this.hp = 1;
    this.score = 100;
  }
  box(): Rect { return { x: this.x - 5, y: this.y - 3, w: 10, h: 6 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.dead = true;
    g.explode(this.x, this.y, 12, 0, 'player', { scale: 0.7, noScorch: true });
    g.addScore(this.score, this.x, this.y - 8);
    return 'metal';
  }
  update(g: Game) {
    this.spd = Math.min(this.maxSpd, this.spd + 0.05);
    this.x += Math.cos(this.ang) * this.spd;
    this.y += Math.sin(this.ang) * this.spd;
    if (this.age % 3 === 0) g.fx.add({ t: PT.Smoke, x: this.x - Math.cos(this.ang) * 6, y: this.y, vy: -0.15, life: 30, size: 1.5, size2: 4, c: C.smoke0 });
    if (--this.life <= 0 || !g.onScreen(this.x, 60)) { this.dead = true; return; }
    const pb = g.player.box();
    if (g.solidAt(this.x, this.y) || (pb && this.x > pb.x && this.x < pb.x + pb.w && this.y > pb.y && this.y < pb.y + pb.h)) {
      this.dead = true;
      g.explode(this.x, this.y, 20, 1, 'enemy', { scale: 1 });
    }
  }
  draw(g: Game, s: Surface) {
    const ca = Math.cos(this.ang), sa = Math.sin(this.ang);
    s.othick(this.x - ca * 7, this.y - sa * 7, this.x + ca * 2, this.y + sa * 2, 3, C.tinSh);
    s.thick(this.x, this.y, this.x + ca * 2, this.y + sa * 2, 3, C.ebul);
    s.pset(this.x - ca * 3, this.y - sa * 3 - 1, C.tinHi);
    const fl = (g.t >> 1) & 1;
    s.disc(this.x - ca * 9, this.y - sa * 9, 1.5 + fl, fl ? C.fire1 : C.fire2);
  }
}

// Artillery shell that falls on a marked spot. `delay` frames of warning reticle first.
export class Mortar extends Ent {
  tx: number;
  ty: number;
  delay: number;
  fall = 0;
  radius: number;
  constructor(tx: number, ty: number, delay = 60, radius = 24) {
    super();
    this.tx = tx; this.ty = ty; this.delay = delay;
    this.x = tx; this.y = ty;
    this.team = 'enemy';
    this.z = 72;
    this.radius = radius;
  }
  update(g: Game) {
    if (this.age === 1) g.snd('whistle', this.tx, 0.4);
    if (this.age >= this.delay) {
      this.dead = true;
      g.explode(this.tx, this.ty - 4, this.radius, 1, 'enemy', { scale: this.radius / 20 });
    }
  }
  draw(g: Game, s: Surface) {
    const k = this.age / this.delay;
    // the marked zone is exactly the area that hurts (explosion reach = 0.75 × radius)
    groundZone(s, this.tx, this.radius * 0.75, this.ty, g.t, k);
    // growing shadow of the incoming shell
    s.ddisc(this.tx, this.ty - 1, 2 + k * 5, C.black, 0.3 + 0.4 * k);
    // the shell is visible for the second half of the warning, with a smoke streak behind it
    if (k > 0.5) {
      const fy = this.ty - ((1 - k) / 0.5) * 200;
      for (let i = 1; i <= 4; i++) s.ddisc(this.tx, fy - 6 - i * 7, 2, C.smoke0, 0.5 - i * 0.1);
      s.othick(this.tx, fy - 7, this.tx, fy, 3, C.tinSh);
      s.rect(this.tx - 1, fy - 1, 3, 2, C.ebul);
    }
  }
}
