import { Surface, Mode } from '../engine/surface';
import { drawText } from '../engine/font';
import { C } from './palette';
import { Ent, type Hit, type Mat, type Rect, type Solid } from './types';
import { PT } from './fx';
import type { Game } from './world';

// Small reactive world details: birds that scatter, crabs that flee, bottles that shatter,
// balconies that collapse, windows that blow out.

export class Gull extends Ent {
  state: 'idle' | 'fly' = 'idle';
  peck = 0;
  facing = 1;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.z = 8;
    this.facing = Math.random() < 0.5 ? -1 : 1;
  }
  scare(g: Game) {
    if (this.state === 'fly') return;
    this.state = 'fly';
    this.vx = (Math.random() < 0.7 ? -1 : 1) * (0.8 + Math.random() * 0.8);
    this.vy = -1.5;
    this.facing = Math.sign(this.vx);
    if (Math.random() < 0.5) g.snd('alert', this.x, 0.15, 1.8, 0.2);
    for (let i = 0; i < 2; i++) g.fx.add({ t: PT.Paper, x: this.x, y: this.y - 3, vx: (Math.random() - 0.5), vy: -0.3, grav: 0.02, life: 60, c: C.white, vr: 0.3 });
  }
  update(g: Game) {
    const p = g.player;
    if (this.state === 'idle') {
      if (Math.abs(p.x - this.x) < 60 || (p.muzzleF > 0 && Math.abs(p.x - this.x) < 140)) this.scare(g);
      if (Math.random() < 0.01) this.peck = 12;
      if (this.peck > 0) this.peck--;
    } else {
      this.vy = Math.max(-1.6, this.vy - 0.02);
      this.x += this.vx;
      this.y += this.vy + Math.sin(this.age * 0.4) * 0.3;
      if (this.y < g.cam.y - 30) this.dead = true;
    }
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const f = this.facing;
    if (this.state === 'idle') {
      s.orect(x - 3, y - 5, 6, 3, C.white);
      s.pset(x + f * 3, y - 6 + (this.peck > 6 ? 2 : 0), C.white);
      s.pset(x + f * 4, y - 6 + (this.peck > 6 ? 2 : 0), C.yellow);
      s.pset(x - f * 3, y - 4, C.steel);
      s.pset(x - 1, y - 1, C.yellow);
      s.pset(x + 1, y - 1, C.yellow);
    } else {
      const up = (g.t >> 2) & 1;
      s.orect(x - 2, y - 2, 5, 2, C.white);
      s.line(x - 2, y - 2, x - 6, y - 2 - (up ? 4 : -1), C.white);
      s.line(x + 2, y - 2, x + 6, y - 2 - (up ? 4 : -1), C.white);
      s.pset(x + f * 3, y - 2, C.yellow);
    }
  }
}

export class Crab extends Ent {
  dir = 0;
  flee = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.z = 9;
    this.hittable = true;
    this.team = 'neutral';
  }
  box(): Rect { return { x: this.x - 3, y: this.y - 3, w: 6, h: 3 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.dead = true;
    g.fx.debris(this.x, this.y - 2, 4, C.red, 1.5, 2, 1);
    g.addScore(10, this.x, this.y - 10);
    return 'flesh';
  }
  update(g: Game) {
    const p = g.player;
    if (Math.abs(p.x - this.x) < 50) this.flee = 30;
    if (this.flee > 0) {
      this.flee--;
      this.x += Math.sign(this.x - p.x) * 1.2;
    } else if (Math.random() < 0.02) this.dir = Math.random() < 0.5 ? -0.3 : 0.3;
    else if (Math.random() < 0.02) this.dir = 0;
    this.x += this.dir;
    if (this.x < g.cam.x - 50) this.dead = true;
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const leg = (g.t >> 2) & 1;
    s.orect(x - 2, y - 3, 5, 2, C.red);
    s.pset(x - 1, y - 4, C.white);
    s.pset(x + 1, y - 4, C.white);
    s.pset(x - 3 - leg, y - 1, C.redSh);
    s.pset(x + 3 + leg, y - 1, C.redSh);
    s.pset(x - 3, y - 4, C.red);
    s.pset(x + 3, y - 4, C.red);
  }
}

export class Bottle extends Ent {
  col: number;
  constructor(x: number, y: number, col = C.green) {
    super();
    this.x = x; this.y = y;
    this.col = col;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 22;
  }
  box(): Rect { return { x: this.x - 2, y: this.y - 7, w: 4, h: 7 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.dead = true;
    g.fx.debris(this.x, this.y - 4, 6, this.col, 1.6, 2.5, 1);
    g.fx.debris(this.x, this.y - 4, 3, C.glass, 1.6, 2.5, 1);
    g.addScore(20, this.x, this.y - 12);
    return 'glass';
  }
  update(_g: Game) {}
  draw(_g: Game, s: Surface) {
    s.orect(this.x - 1, this.y - 5, 3, 5, this.col);
    s.rect(this.x, this.y - 7, 1, 2, this.col);
    s.pset(this.x - 1, this.y - 4, C.white);
  }
}

// Campfire (ambient light + embers)
export class Campfire extends Ent {
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.z = 18;
  }
  update(g: Game) {
    if (this.age % 3 === 0) g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 6, y: this.y - 3, vy: -0.6, life: 14, size: 2 + Math.random() * 1.5, c: C.fire2 });
    if (this.age % 12 === 0) g.fx.embers(this.x, this.y - 6, 1, 3);
    if (this.age % 6 === 0) g.fx.light(this.x, this.y - 6, 26, [70, 40, 10], 8);
  }
  draw(_g: Game, s: Surface) {
    s.othick(this.x - 6, this.y - 1, this.x + 6, this.y - 3, 2, C.woodSh);
    s.othick(this.x - 6, this.y - 3, this.x + 6, this.y - 1, 2, C.wood);
    for (let i = -7; i <= 7; i += 3) s.odisc(this.x + i, this.y, 1.5, C.stoneSh);
  }
}

// A balcony platform on a building: one-way solid that collapses after enough damage.
export class Balcony extends Ent {
  w: number;
  plat: Solid;
  falling = false;
  rot = 0;
  col: number;
  constructor(g: Game, x: number, y: number, w: number, col = C.woodSh) {
    super();
    this.x = x; this.y = y; this.w = w;
    this.col = col;
    this.hp = 10;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 16;
    this.plat = g.solid(x, y, w, 4, true, 'balcony');
  }
  box(): Rect | null { return this.falling ? null : { x: this.x, y: this.y, w: this.w, h: 8 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.falling || h.from !== 'player') return null;
    // only shots hitting the underside/deck count (not bullets flying over the top)
    this.hp -= h.kind === 'explosion' ? h.dmg * 2 : h.dmg;
    this.flash = 2;
    if (this.hp <= 0) this.collapse(g, h.dx);
    return 'wood';
  }
  collapse(g: Game, dir: number) {
    this.falling = true;
    this.plat.alive = false;
    this.vy = 0;
    this.vx = dir * 0.3;
    g.snd('wood', this.x, 0.8, 0.8);
    g.fx.chunks(this.x + this.w / 2, this.y, 5, C.wood, C.woodHi, 7, 2, 2, 2);
    for (const e of g.ents) {
      if (e === this || e.dead) continue;
      if (e.team === 'enemy' && 'onGround' in e && e.x > this.x - 2 && e.x < this.x + this.w + 2 && Math.abs(e.y - this.y) < 2) {
        (e as unknown as { onGround: boolean }).onGround = false;
        e.vy = -1;
        g.later(8, () => { if (!e.dead && e.hittable) e.onHit(g, { dmg: 99, kind: 'explosion', x: e.x, y: e.y, dx: dir, dy: -1, force: 1, from: 'player' }); });
      }
    }
    g.addScore(100, this.x + this.w / 2, this.y - 10);
  }
  update(g: Game) {
    if (!this.falling) return;
    this.vy += 0.25;
    this.y += this.vy;
    this.x += this.vx;
    this.rot += 0.04;
    if (this.y >= g.groundAt(this.x + this.w / 2, 0) - 3) {
      this.dead = true;
      g.fx.chunks(this.x + this.w / 2, this.y - 2, 8, C.wood, C.woodHi, 8, 2, 3, 3);
      g.fx.dust(this.x + this.w / 2, this.y, 8);
      g.snd('crumble', this.x, 0.6, 1.2);
      g.shake(2);
    }
  }
  draw(_g: Game, s: Surface) {
    const col = this.flash > 0 ? C.white : this.col;
    const x = Math.round(this.x), y = Math.round(this.y);
    const tilt = Math.round(this.rot * 10);
    s.orect(x, y + (this.falling ? tilt : 0), this.w, 3, col);
    // railing
    for (let i = 2; i < this.w - 1; i += 4) s.othick(x + i, y - 9, x + i, y, 1, C.steelSh);
    s.othick(x, y - 10, x + this.w - 1, y - 10 + (this.falling ? tilt : 0), 1, C.steelSh);
    // brackets
    if (!this.falling) {
      s.line(x + 2, y + 3, x + 6, y + 8, C.steelSh);
      s.line(x + this.w - 3, y + 3, x + this.w - 7, y + 8, C.steelSh);
    }
  }
}

// Background building facade with windows that blow out from nearby explosions.
export interface WinState { x: number; y: number; w: number; h: number; broken: boolean; lit: boolean }
export class Building extends Ent {
  w: number;
  h: number;
  col: number;
  shade: number;
  roof: number;
  wins: WinState[] = [];
  door: number;
  doorOpen = false;
  rattle = 0;
  smashed = 0;
  sign?: string;
  awning?: { y: number; col: number; plat: Solid };
  constructor(g: Game, x: number, w: number, h: number, col: number, shade: number, roof: number, ground = 184, o: { awning?: number; sign?: string; winRows?: number } = {}) {
    super();
    this.x = x; this.y = ground;
    this.w = w; this.h = h;
    this.col = col; this.shade = shade; this.roof = roof;
    this.z = 2;
    this.sign = o.sign;
    const rows = o.winRows ?? Math.max(1, Math.floor((h - 40) / 30));
    const cols = Math.max(1, Math.floor((w - 10) / 24));
    const sp = w / cols;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        this.wins.push({ x: Math.round(x + sp * (c + 0.5) - 5), y: ground - h + 14 + r * 30, w: 10, h: 14, broken: false, lit: Math.random() < 0.2 });
      }
    this.door = x + Math.floor(w * 0.35);
    if (o.awning !== undefined) {
      const plat = g.solid(x + 4, ground - o.awning, w - 8, 3, true, 'awning');
      this.awning = { y: ground - o.awning, col: o.awning % 2 ? C.red : C.teal, plat };
    }
  }
  blast(g: Game, x: number, y: number, r: number) {
    for (const w of this.wins) {
      if (w.broken) continue;
      if (Math.hypot(w.x + w.w / 2 - x, w.y + w.h / 2 - y) < r + 16) {
        w.broken = true;
        g.fx.debris(w.x + w.w / 2, w.y + w.h / 2, 6, C.glass, 1.8, 2, 1);
        g.snd('glass', w.x, 0.35);
      }
    }
  }
  // A trooper kicks the door open: the leaf flies off in pieces with a puff of dust.
  kickDoor(g: Game) {
    this.doorOpen = true;
    this.rattle = 0;
    const cx = this.door + 7;
    g.fx.chunks(cx, this.y - 14, 5, C.woodSh, C.wood, 7, 2, 2.2, 3);
    g.fx.dust(cx, this.y, 6, -1, C.plasterSh);
    g.snd('wood', cx, 0.8, 0.9);
    g.shake(1.5);
  }
  update(_g: Game) {
    if (this.rattle > 0) this.rattle--;
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x), top = Math.round(this.y - this.h), w = this.w, h = this.h;
    if (x > s.ox + s.w + 10 || x + w < s.ox - 10) return;
    s.orect(x, top, w, h, this.col);
    s.rect(x + w - 4, top, 4, h, this.shade);
    s.rect(x, top, w, 2, this.shade);
    // plaster cracks / bricks peeking out
    for (let i = 0; i < 4; i++) {
      const bx = x + ((i * 37 + x) % (w - 10)) + 3, by = top + 20 + ((i * 53 + x) % (h - 40));
      s.rect(bx, by, 5, 2, this.shade);
      s.pset(bx + 1, by - 1, this.shade);
    }
    // roof
    s.orect(x - 3, top - 5, w + 6, 5, this.roof);
    s.rect(x - 3, top - 5, w + 6, 1, C.fire3);
    for (let i = x - 2; i < x + w + 2; i += 4) s.pset(i, top - 2, C.roofSh);
    // windows
    for (const wn of this.wins) {
      s.orect(wn.x, wn.y, wn.w, wn.h, wn.broken ? C.black : wn.lit ? C.fire1 : C.glassSh);
      if (!wn.broken) {
        s.rect(wn.x + 1, wn.y + 1, 3, wn.h - 2, C.glass);
        s.rect(wn.x, wn.y + 6, wn.w, 1, C.woodSh);
      } else {
        s.pset(wn.x + 1, wn.y + 1, C.glass);
        s.pset(wn.x + wn.w - 2, wn.y + 2, C.glass);
      }
      // shutters
      s.rect(wn.x - 3, wn.y, 2, wn.h, C.teal);
      s.rect(wn.x + wn.w + 1, wn.y, 2, wn.h, C.teal);
      s.rect(wn.x - 1, wn.y + wn.h + 1, wn.w + 2, 2, this.shade);
    }
    // door: rattles before an ambush, then hangs open as a dark doorway
    if (this.doorOpen) {
      s.orect(this.door, this.y - 26, 14, 26, C.black);
      s.rect(this.door + 1, this.y - 25, 12, 3, C.stoneDk);
      s.othick(this.door - 3, this.y - 25, this.door - 1, this.y - 2, 1, C.woodSh); // swung-open leaf
    } else {
      const jx = this.rattle > 0 ? ((this.rattle >> 1) & 1 ? 1 : -1) : 0;
      s.orect(this.door + jx, this.y - 26, 14, 26, C.woodSh);
      s.rect(this.door + 1 + jx, this.y - 25, 12, 1, C.wood);
      s.rect(this.door + 6 + jx, this.y - 25, 1, 25, C.black);
      if (this.rattle > 0 && (this.rattle & 4)) s.rect(this.door + 2, this.y - 27, 10, 1, C.stoneDk);
    }
    if (this.sign) {
      s.orect(x + 6, this.y - 42, w - 12, 9, C.woodSh);
      signText(s, this.sign, x + w / 2, this.y - 41);
    }
    if (this.awning) {
      const ay = this.awning.y;
      for (let i = x + 4; i < x + w - 4; i += 6) {
        s.orect(i, ay, 6, 4, ((i - x) / 6) % 2 < 1 ? this.awning.col : C.offwhite);
        s.pset(i + 2, ay + 4, this.awning.col);
      }
      s.rect(x + 4, ay - 1, w - 8, 1, C.black);
    }
    if (this.smashed > 0) {
      // jagged breach where the tank burst through the wall
      const cx = x + w / 2, top = this.y - 52;
      for (let yy = top; yy < this.y; yy++) {
        const k = (yy - top) / 52;
        const half = 16 + k * 22 + ((yy * 7) % 5) - 2;
        s.rect(cx - half - 2, yy, half * 2 + 4, 1, this.shade);
        s.rect(cx - half, yy, half * 2, 1, yy % 9 < 1 ? C.stoneDk : C.black);
      }
      // exposed bricks along the edge
      for (let i = 0; i < 9; i++) {
        const yy = top + 4 + i * 6;
        const half = 16 + ((yy - top) / 52) * 22;
        s.orect(cx - half - 6, yy, 5, 3, C.roofSh);
        s.orect(cx + half + 1, yy + 2, 5, 3, C.roofSh);
      }
      // rubble pile at the foot
      for (let i = 0; i < 12; i++) s.orect(cx - 36 + i * 6, this.y - 5 - ((i * 13) % 5), 6, 5, i % 2 ? C.plasterSh : C.stoneSh);
    }
    void g;
  }
}

function signText(s: Surface, str: string, cx: number, y: number) {
  drawText(s, str, cx, y, C.hud, { align: 'center', outline: null });
}
