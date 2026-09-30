import { Surface, Mode, fromRows } from '../engine/surface';
import { drawText } from '../engine/font';
import { audio } from '../engine/audio';
import { C } from './palette';
import { Ent, type Hit, type Mat, type Rect, type Solid } from './types';
import { Rig, ik, v, type V, HEAD_POW, HEAD_POW_HAPPY, bake } from './puppet';
import { WEAPONS, type WeaponId, EBullet } from './weapons';
import { Soldier, type Role } from './enemies';
import { Gib } from './gib';
import { PT } from './fx';
import { aimLine } from './danger';
import type { Game } from './world';

// ------------------------------------------------------------------ Crate
export class Crate extends Ent {
  drop: WeaponId | 'bombs' | 'score' | null;
  wob = 0;
  big: boolean;
  constructor(x: number, y: number, drop: WeaponId | 'bombs' | 'score' | null = null, big = false) {
    super();
    this.x = x; this.y = y;
    this.drop = drop;
    this.big = big;
    this.hp = big ? 7 : 4;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 20;
  }
  box(): Rect { const w = this.big ? 22 : 18, h = this.big ? 22 : 18; return { x: this.x - w / 2, y: this.y - h, w, h }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.hp -= h.dmg;
    this.flash = 2;
    this.wob = 5;
    if (this.hp <= 0) this.smash(g);
    return 'wood';
  }
  smash(g: Game) {
    this.dead = true;
    const b = this.box();
    g.fx.chunks(this.x, b.y + b.h / 2, 7, C.wood, C.woodHi, 7, 2, 2.5, 4);
    g.fx.debris(this.x, b.y + b.h / 2, 8, C.woodSh, 2, 3);
    g.fx.dust(this.x, this.y, 6, 0, C.woodSh);
    g.snd('wood', this.x, 0.8);
    g.shake(1.5);
    g.addScore(50);
    if (this.drop) g.add(new Pickup(this.x, this.y - 6, this.drop));
  }
  update(_g: Game) {
    if (this.wob > 0) this.wob--;
  }
  draw(_g: Game, s: Surface) {
    const b = this.box();
    const jx = this.wob > 0 ? (this.wob & 1 ? 1 : -1) : 0;
    const x = Math.round(b.x) + jx, y = Math.round(b.y);
    if (this.flash > 0) { s.orect(x, y, b.w, b.h, C.white); return; }
    s.orect(x, y, b.w, b.h, C.wood);
    s.rect(x, y, b.w, 1, C.woodHi);
    s.rect(x, y + b.h - 2, b.w, 2, C.woodSh);
    s.line(x + 1, y + 1, x + b.w - 2, y + b.h - 2, C.woodSh);
    s.rect(x, y + (b.h >> 1), b.w, 1, C.woodSh);
    s.rect(x + 1, y + 1, 1, b.h - 2, C.woodHi);
    s.rect(x + b.w - 2, y + 1, 1, b.h - 2, C.woodSh);
    if (this.drop && this.drop !== 'score' && this.drop !== 'bombs') {
      s.orect(x + (b.w >> 1) - 3, y + 3, 6, 6, WEAPONS[this.drop].color);
    }
    if (this.hp < (this.big ? 4 : 2)) { s.line(x + 3, y + 2, x + 6, y + 6, C.black); s.line(x + b.w - 4, y + b.h - 3, x + b.w - 7, y + b.h - 6, C.black); }
  }
}

// ------------------------------------------------------------------ Explosive barrel
export class Barrel extends Ent {
  fuse = -1;
  wob = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.hp = 4;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 21;
  }
  box(): Rect { return { x: this.x - 7, y: this.y - 20, w: 14, h: 20 }; }
  onHit(g: Game, h: Hit): Mat | null {
    this.hp -= h.kind === 'explosion' ? 99 : h.dmg;
    this.flash = 2;
    this.wob = 4;
    if (this.hp <= 0 && this.fuse < 0) {
      this.fuse = h.kind === 'explosion' ? 6 + ((Math.random() * 6) | 0) : 26;
      g.snd('steam', this.x, 0.5, 1.4);
    }
    return 'metal';
  }
  update(g: Game) {
    if (this.wob > 0) this.wob--;
    if (this.fuse >= 0) {
      this.fuse--;
      g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 6, y: this.y - 17, vy: -1.2, vx: (Math.random() - 0.5) * 0.5, life: 12, size: 2.5, c: C.fire2 });
      if (this.fuse % 3 === 0) g.fx.sparks(this.x, this.y - 16, 1, -Math.PI / 2, 0.8, 2);
      this.wob = 2;
      if (this.fuse <= 0) {
        this.dead = true;
        g.explode(this.x, this.y - 10, 40, 12, 'player', { scale: 1.8 });
        g.fx.chunks(this.x, this.y - 10, 5, C.red, C.redSh, 6, 2, 3.5, 5);
        g.hitstop(3);
      }
    }
  }
  draw(g: Game, s: Surface) {
    const jx = this.wob > 0 ? (this.wob & 1 ? 1 : -1) : 0;
    const x = Math.round(this.x - 7) + jx, y = Math.round(this.y - 20);
    const hot = this.fuse >= 0 && (g.t & 2);
    if (this.flash > 0 || hot) { s.orect(x, y, 14, 20, hot ? C.fire1 : C.white); return; }
    s.orect(x, y, 14, 20, C.red);
    s.rect(x + 1, y, 3, 20, C.fire3);
    s.rect(x + 10, y, 4, 20, C.redSh);
    s.rect(x, y + 4, 14, 1, C.redSh);
    s.rect(x, y + 15, 14, 1, C.redSh);
    s.rect(x + 3, y + 7, 8, 5, C.yellow);
    s.rect(x + 6, y + 7, 2, 5, C.black);
    s.rect(x + 2, y - 1, 10, 1, C.steelSh);
  }
}

// ------------------------------------------------------------------ Sandbags
export class Sandbags extends Ent {
  w: number;
  maxHp: number;
  constructor(x: number, y: number, w = 30) {
    super();
    this.x = x; this.y = y; this.w = w;
    this.hp = this.maxHp = 14 + w * 0.3;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 35;
  }
  box(): Rect | null {
    const h = this.hp > 0 ? 14 : 0;
    return h ? { x: this.x - this.w / 2, y: this.y - h, w: this.w, h } : null;
  }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.hp <= 0) return null;
    this.hp -= h.kind === 'explosion' ? h.dmg * 1.5 : h.dmg * 0.8;
    if (Math.random() < 0.5) g.fx.debris(h.x, h.y, 2, C.sand, 1.2, 2, 1);
    if (this.hp <= 0) {
      g.fx.dust(this.x, this.y - 6, 10, 0, C.sandSh);
      g.fx.debris(this.x, this.y - 8, 14, C.sandSh, 2.5, 3, 2);
      g.snd('sand', this.x, 0.9, 0.6);
      // soldiers behind lose their cover
      for (const e of g.ents) if (e instanceof Soldier && Math.abs(e.x - this.x) < this.w) e.cover = false;
    }
    return 'sand';
  }
  update(_g: Game) {}
  draw(_g: Game, s: Surface) {
    const k = this.hp / this.maxHp;
    const rows = this.hp <= 0 ? 1 : k > 0.66 ? 3 : k > 0.33 ? 2 : 1;
    const x0 = Math.round(this.x - this.w / 2);
    for (let r = 0; r < rows; r++) {
      const y = Math.round(this.y - 5 - r * 4.5);
      const off = r % 2 ? 4 : 0;
      for (let bx = x0 + off - (r ? 0 : 1); bx < x0 + this.w - 4 + (r ? 0 : 1); bx += 8) {
        s.odisc(bx + 4, y + 2, 2.5, C.sand);
        s.rect(bx + 1, y, 7, 4, C.sand);
        s.rect(bx + 1, y + 3, 7, 1, C.sandSh);
        s.pset(bx + 4, y + 1, C.offwhite);
      }
    }
  }
}

// ------------------------------------------------------------------ Pickups
export class Pickup extends Ent {
  kind: WeaponId | 'bombs' | 'score';
  bob = Math.random() * 6;
  life = 900;
  constructor(x: number, y: number, kind: WeaponId | 'bombs' | 'score') {
    super();
    this.x = x; this.y = y;
    this.vy = -2.5;
    this.kind = kind;
    this.z = 45;
  }
  update(g: Game) {
    this.vy = Math.min(3, this.vy + 0.2);
    this.y += this.vy;
    const gy = g.groundAt(this.x, this.y - 6);
    if (this.y > gy) { this.y = gy; this.vy = 0; }
    this.bob += 0.1;
    const p = g.player;
    const pb = p.box();
    if (pb && Math.abs(p.x - this.x) < 12 && this.y > pb.y - 4 && this.y - 12 < pb.y + pb.h) {
      this.dead = true;
      if (this.kind === 'bombs') {
        p.bombs += 10;
        g.snd('bombs', this.x, 0.7);
        audio.voice('bombs', { priority: true });
        g.fx.text(this.x, this.y - 24, 'BOMBS +10');
      } else if (this.kind === 'score') {
        g.addScore(1000, this.x, this.y - 20);
        g.snd('pickup', this.x, 0.6);
      } else {
        p.giveWeapon(g, this.kind);
        g.fx.text(this.x, this.y - 24, WEAPONS[this.kind].name, WEAPONS[this.kind].color);
      }
      g.fx.ring(this.x, this.y - 8, 2, 16, 10, C.hud);
    }
    if (--this.life <= 0 || this.x < g.cam.x - 40) this.dead = true;
  }
  draw(g: Game, s: Surface) {
    if (this.life < 120 && (this.life & 4)) return;
    const y = Math.round(this.y - 12 + (this.vy === 0 ? Math.sin(this.bob) * 1.5 : 0));
    const x = Math.round(this.x - 6);
    if (this.kind === 'score') {
      // golden rivet
      s.odisc(this.x, y + 6, 4, C.brass);
      s.disc(this.x - 1, y + 5, 2, C.yellow);
      s.pset(this.x - 2, y + 4, C.white);
      return;
    }
    const col = this.kind === 'bombs' ? C.vest : WEAPONS[this.kind].color;
    s.orect(x, y, 12, 12, col);
    s.rect(x + 1, y + 1, 10, 1, C.white);
    s.rect(x, y + 10, 12, 2, C.black);
    const letter = this.kind === 'bombs' ? 'B' : WEAPONS[this.kind].letter;
    drawText(s, letter, x + 4, y + 2, (g.t >> 3) & 1 ? C.white : C.hud, { outline: C.black });
  }
}

// ------------------------------------------------------------------ Hostage (captured dock worker)
const powRig = new Rig(56, 52, 28, 44);
export class Hostage extends Ent {
  gift: WeaponId | 'bombs' | 'score';
  state: 'tied' | 'free' | 'salute' | 'give' | 'run' = 'tied';
  st = 0;
  facing = 1;
  runPhase = 0;
  constructor(x: number, y: number, gift: WeaponId | 'bombs' | 'score') {
    super();
    this.x = x; this.y = y;
    this.gift = gift;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 25;
  }
  box(): Rect | null { return this.state === 'tied' ? { x: this.x - 8, y: this.y - 18, w: 16, h: 18 } : null; }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.state !== 'tied' || h.from !== 'player') return null;
    this.free(g);
    return 'wood';
  }
  free(g: Game) {
    this.state = 'free';
    this.st = 0;
    this.hittable = false;
    g.rescued++;
    g.fx.chunks(this.x, this.y - 10, 4, C.woodHi, C.wood, 5, 1, 1.5, 2.5);
    g.snd('rescue', this.x, 0.6);
    g.addScore(1000, this.x, this.y - 34);
    this.facing = g.player.x > this.x ? 1 : -1;
  }
  update(g: Game) {
    this.st++;
    const p = g.player;
    if (this.state === 'tied') {
      if (Math.abs(p.x - this.x) < 12 && Math.abs(p.y - this.y) < 20) this.free(g);
      return;
    }
    if (this.state === 'free' && this.st > 14) { this.state = 'salute'; this.st = 0; audio.voice('thanks', { fallback: 'rescue', vol: 0.9 }); }
    if (this.state === 'salute' && this.st > 36) { this.state = 'give'; this.st = 0; }
    if (this.state === 'give' && this.st === 16) g.add(new Pickup(this.x + this.facing * 12, this.y - 12, this.gift));
    if (this.state === 'give' && this.st > 30) { this.state = 'run'; this.st = 0; this.facing = -1; }
    if (this.state === 'run') {
      this.x -= 2.4;
      this.runPhase = (this.runPhase + 0.12) % 1;
      if (this.x < g.cam.x - 30) this.dead = true;
    }
  }
  draw(g: Game, s: Surface) {
    const R = powRig;
    R.begin();
    let hip = v(0, -11), neck = v(0, -20);
    let fB = v(-3, 0), fF = v(3, 0);
    let hF: V = v(2, -10), hB: V = v(-2, -10);
    let head = HEAD_POW;
    const t = this.st;
    if (this.state === 'tied') {
      hip = v(-1, -4);
      fB = v(4, 0); fF = v(6, 0);
      const sh = (g.t >> 3) & 1;
      neck = v(-2 + sh, -13);
      hF = v(-4, -8); hB = v(-5, -8);
    } else if (this.state === 'free') {
      hip = v(0, -11 - (t < 8 ? 3 : 0));
      neck = v(0, -20 - (t < 8 ? 3 : 0));
      hF = v(5, -24); hB = v(-5, -24);
      head = HEAD_POW_HAPPY;
    } else if (this.state === 'salute') {
      hF = v(4, -26);
      hB = v(-1, -10);
      head = HEAD_POW_HAPPY;
    } else if (this.state === 'give') {
      hF = t < 10 ? v(-2, -8) : v(8, -15);
      head = HEAD_POW_HAPPY;
    } else {
      const p = Math.floor(this.runPhase * 8) / 8;
      const leg = (q: number): V => { q = ((q % 1) + 1) % 1; if (q < 0.5) return v(6 - 24 * q, 0); const k = (q - 0.5) / 0.5; return v(-6 + 12 * k, -Math.sin(k * Math.PI) * 5); };
      fF = leg(p); fB = leg(p + 0.5);
      neck = v(3, -20);
      hF = v(8, -26); hB = v(-4, -14);
      head = HEAD_POW_HAPPY;
    }
    const shF = v(neck.x + 1, neck.y + 2), shB = v(neck.x - 1, neck.y + 2);
    const eB = ik(shB, hB, 5, 5, 1);
    R.limb(shB, eB, 3, C.skinSh);
    R.limb(eB, hB, 2, C.skinSh);
    for (const [f, back] of [[fB, true], [fF, false]] as [V, boolean][]) {
      const ankle = v(f.x, f.y - 2);
      const knee = ik(hip, ankle, 5.5, 5.5, this.state === 'tied' ? 1 : -1);
      R.limb(hip, knee, 3, back ? C.woodSh : C.wood);
      R.limb(knee, ankle, 2, C.skin);
      R.orect(ankle.x - 1, ankle.y, 4, 2, C.skinSh);
    }
    R.limb(hip, neck, 7, C.offwhite);
    R.bare(v(hip.x - 3, neck.y + 4), v(hip.x + 3, neck.y + 4), 1, C.blue);
    R.bare(v(hip.x - 3, neck.y + 7), v(hip.x + 3, neck.y + 7), 1, C.blue);
    R.sprite(head, neck.x - 5, neck.y - 10);
    const eF = ik(shF, hF, 5, 5, 1);
    R.limb(shF, eF, 3, C.skin);
    R.limb(eF, hF, 2, C.skin);
    if (this.state === 'tied') {
      // ropes + post
      R.orect(-7, -24, 3, 24, C.woodSh);
      R.bare(v(-6, -12), v(3, -12), 1, C.woodHi);
      R.bare(v(-6, -9), v(3, -9), 1, C.woodHi);
    }
    R.present(s, this.x, this.y, this.facing < 0);
    if (this.state === 'tied' && ((g.t >> 5) & 1)) drawText(s, 'HELP!', this.x - 12, this.y - 34, C.white);
  }
}

// ------------------------------------------------------------------ Watchtower (collapses)
export class Tower extends Ent {
  top: Solid;
  fall = 0;
  fallDir = 1;
  collapsed = false;
  h: number;
  constructor(g: Game, x: number, y: number, h = 56) {
    super();
    this.x = x; this.y = y; this.h = h;
    this.hp = 16;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 15;
    this.top = g.solid(x - 18, y - h, 36, 4, true, 'tower');
  }
  box(): Rect | null { return this.collapsed ? null : { x: this.x - 14, y: this.y - this.h + 6, w: 28, h: this.h - 6 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.collapsed) return null;
    // bullets aimed at the upper part pass through the gaps
    if (h.kind !== 'explosion' && h.y < this.y - this.h + 14) return null;
    this.hp -= h.kind === 'explosion' ? h.dmg * 1.5 : h.dmg;
    this.flash = 2;
    if (this.hp <= 0) {
      this.collapsed = true;
      this.fallDir = h.dx >= 0 ? 1 : -1;
      this.top.alive = false;
      g.snd('crumble', this.x, 0.9);
      g.snd('wood', this.x, 0.9, 0.7);
      g.shake(4);
      g.fx.chunks(this.x, this.y - 20, 10, C.wood, C.woodHi, 10, 2, 3, 4);
      // everyone on top falls
      for (const e of g.ents) if (e instanceof Soldier && Math.abs(e.x - this.x) < 20 && e.y < this.y - this.h + 4) {
        e.onGround = false;
        e.vy = -1.5;
        e.vx = this.fallDir * 1.5;
        e.onHit(g, { dmg: 99, kind: 'explosion', x: e.x, y: e.y, dx: this.fallDir, dy: -1, force: 1.5, from: 'player' });
      }
      g.addScore(200, this.x, this.y - this.h);
    }
    return 'wood';
  }
  update(g: Game) {
    if (this.collapsed && this.fall < 1) {
      this.fall = Math.min(1, this.fall + 0.012 + this.fall * 0.06);
      if (this.fall >= 1) {
        g.shake(5);
        g.fx.dust(this.x + this.fallDir * 30, this.y, 14, this.fallDir, C.sandSh);
        g.fx.chunks(this.x + this.fallDir * 30, this.y - 6, 8, C.wood, C.woodHi, 9, 2, 3, 3);
        g.snd('crumble', this.x, 0.8, 0.8);
        this.dead = true;
        g.fx.decals.push({ x: this.x + this.fallDir * 26, y: this.y, kind: 'scorch', r: 20, seed: 1 });
      }
    }
  }
  draw(_g: Game, s: Surface) {
    const ang = this.fall * this.fall * (Math.PI / 2) * this.fallDir;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const P = (lx: number, ly: number) => [this.x + lx * ca - ly * sa, this.y + lx * sa + ly * ca] as const;
    const col = this.flash > 0 ? C.white : C.wood;
    const H = this.h;
    const leg = (x0: number, x1: number) => { const a = P(x0, 0), b = P(x1, -H); s.othick(a[0], a[1], b[0], b[1], 3, col); };
    leg(-14, -12);
    leg(14, 12);
    // cross braces
    for (const yy of [-H * 0.3, -H * 0.62]) {
      const a = P(-13, yy), b = P(13, yy - H * 0.25);
      s.othick(a[0], a[1], b[0], b[1], 1, C.woodSh);
      const c = P(13, yy), d = P(-13, yy - H * 0.25);
      s.othick(c[0], c[1], d[0], d[1], 1, C.woodSh);
    }
    // platform + railing + roof
    const p0 = P(-18, -H), p1 = P(18, -H);
    s.othick(p0[0], p0[1], p1[0], p1[1], 3, C.woodHi);
    for (const xx of [-17, 17]) { const a = P(xx, -H), b = P(xx, -H - 30); s.othick(a[0], a[1], b[0], b[1], 1, C.woodSh); }
    const r0 = P(-17, -H - 10), r1 = P(17, -H - 10);
    s.othick(r0[0], r0[1], r1[0], r1[1], 1, C.wood);
    const t0 = P(-22, -H - 30), t1 = P(0, -H - 38), t2 = P(22, -H - 30);
    s.othick(t0[0], t0[1], t1[0], t1[1], 3, C.roof);
    s.othick(t1[0], t1[1], t2[0], t2[1], 3, C.roofSh);
    if (this.hp < 8 && !this.collapsed) { const a = P(-12, -8), b = P(-9, -18); s.line(a[0], a[1], b[0], b[1], C.black); }
  }
}

// ------------------------------------------------------------------ Bunker (spawns troops, MG slit)
export class Bunker extends Ent {
  maxHp = 70;
  spawnCd = 90;
  spawned = 0;
  maxSpawn: number;
  mgCd = 120;
  burst = 0;
  doorT = 0;
  slitWarn = 0;
  slitAim = Math.PI;
  wall: Solid;
  broken = false;
  constructor(g: Game, x: number, y: number, maxSpawn = 6) {
    super();
    this.x = x; this.y = y;
    this.hp = this.maxHp;
    this.maxSpawn = maxSpawn;
    this.hittable = true;
    this.team = 'enemy';
    this.counts = true;
    this.z = 12;
    this.score = 2000;
    this.wall = g.solid(x - 30, y - 40, 60, 40, false, 'bunker');
  }
  box(): Rect | null { return this.broken ? null : { x: this.x - 30, y: this.y - 44, w: 60, h: 44 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.broken || h.from !== 'player') return null;
    this.hp -= h.kind === 'explosion' ? h.dmg * 1.2 : h.dmg * 0.8;
    this.flash = 2;
    if (Math.random() < 0.4) g.fx.debris(h.x, h.y, 2, C.stone, 1.5, 2, 2);
    if (this.hp <= 0) this.destroy(g);
    return 'stone';
  }
  destroy(g: Game) {
    this.broken = true;
    this.hittable = false;
    this.counts = false;
    this.wall.h = 14;
    this.wall.y = this.y - 14;
    g.addScore(this.score, this.x, this.y - 50);
    g.kills++;
    for (let i = 0; i < 5; i++) g.later(i * 7, () => g.explode(this.x + (Math.random() - 0.5) * 50, this.y - 10 - Math.random() * 30, 30, 0, 'player', { scale: 1.6 }));
    g.fx.chunks(this.x, this.y - 30, 16, C.stone, C.stoneSh, 8, 3, 4, 6);
    g.snd('crumble', this.x, 1);
    g.shake(8);
    g.hitstop(5);
    g.flash(3, C.fire1);
  }
  update(g: Game) {
    if (this.broken) {
      if (this.age % 5 === 0) g.fx.smoke(this.x + (Math.random() - 0.5) * 40, this.y - 14, 1, 5, C.smoke2, 0.6);
      if (this.age % 3 === 0) g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 40, y: this.y - 14, vy: -0.8, life: 14, size: 3, c: C.fire2 });
      return;
    }
    if (!g.onScreen(this.x, 40)) return;
    const p = g.player;
    // troops pour out of the side door: the door swings open first, then a trooper steps out
    if (this.spawnCd === 14 && this.spawned < this.maxSpawn) {
      this.doorT = 34;
      g.snd('clank', this.x - 34, 0.3, 0.7);
    }
    if (this.doorT > 0) this.doorT--;
    if (--this.spawnCd <= 0 && this.spawned < this.maxSpawn) {
      let alive = 0;
      for (const e of g.ents) if (e instanceof Soldier && e.tag === this.tag && e.state !== 'dying') alive++;
      if (alive < 3) {
        const role: Role = this.spawned % 3 === 2 ? 'grenadier' : 'rifle';
        // Keep the entire body outside the solid wall; an overlap ejects it to the far side.
        const s = new Soldier(this.wall.x - 8, this.y, role, 'none', -1);
        s.tag = this.tag;
        s.origin = 'door';
        s.enter('run', -1.4);
        g.add(s);
        this.spawned++;
        g.fx.dust(this.x - 34, this.y, 4, -1, C.stoneSh);
        g.snd('wood', this.x, 0.3, 0.6);
      } else this.doorT = 0;
      this.spawnCd = 100;
    }
    // MG slit burst
    if (p.x < this.x - 20) {
      if (--this.mgCd <= 0) { this.slitWarn = 24; this.mgCd = 150; g.snd('clank', this.x, 0.3, 1.5); }
      if (this.slitWarn > 0) {
        const my = this.y - 26;
        const a = Math.atan2(p.y - 14 - my, p.x - (this.x - 30));
        this.slitAim = Math.max(Math.PI - 0.3, Math.min(Math.PI + 0.3, a < 0 ? a + Math.PI * 2 : a));
        if (--this.slitWarn === 0) this.burst = 5;
      }
      if (this.burst > 0 && this.age % 7 === 0) {
        this.burst--;
        const my = this.y - 26;
        const a = Math.atan2(p.y - 14 - my, p.x - (this.x - 30));
        const aa = Math.max(Math.PI - 0.3, Math.min(Math.PI + 0.3, a < 0 ? a + Math.PI * 2 : a));
        g.add(new EBullet(this.x - 30, my, Math.cos(aa) * 2.6, Math.sin(aa) * 2.6));
        g.snd('gat', this.x, 0.35, 0.7);
        g.fx.light(this.x - 30, my, 16, [120, 60, 60], 3);
      }
    }
    if (this.hp < this.maxHp * 0.5 && this.age % 6 === 0) g.fx.smoke(this.x + 10, this.y - 40, 1, 4, C.smoke1, 0.6);
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x - 30), y = Math.round(this.y - 44);
    if (this.broken) {
      s.orect(x + 2, this.y - 14, 56, 14, C.stoneDk);
      for (let i = 0; i < 8; i++) s.orect(x + 4 + i * 7, this.y - 16 - (i * 37 % 5), 5, 4, C.stoneSh);
      return;
    }
    const col = this.flash > 0 ? C.white : C.stone;
    // dome-ish concrete pillbox
    s.orect(x, y + 10, 60, 34, col);
    s.orect(x + 6, y + 2, 48, 10, col);
    s.rect(x + 6, y + 2, 48, 2, C.plaster);
    s.rect(x, y + 10, 60, 2, C.plaster);
    s.rect(x, y + 40, 60, 4, C.stoneSh);
    // MG slit with muzzle
    s.rect(x + 2, y + 16, 18, 4, this.slitWarn > 0 && (g.t & 4) ? C.ebul : C.black);
    if (this.burst > 0 && (g.t & 2)) s.disc(x, y + 18, 3, C.fire1);
    if (this.slitWarn > 0) aimLine(s, x, y + 18, this.slitAim, 200, g.t, this.slitWarn < 12);
    s.othick(x - 4, y + 18, x + 4, y + 18, 2, C.gun);
    // side trench door (troops pour out on the left)
    s.orect(x - 8, y + 24, 9, 20, C.stoneSh);
    s.orect(x - 6, y + 26, 6, 18, this.doorT > 0 ? C.black : C.woodSh);
    if (this.doorT > 0) s.othick(x - 9, y + 27, x - 11, y + 43, 1, C.woodSh); // open door leaf
    s.rect(x + 26, y + 22, 10, 18, C.stoneSh);
    s.rect(x + 27, y + 23, 8, 1, C.plaster);
    // cracks per damage
    const k = this.hp / this.maxHp;
    if (k < 0.7) { s.line(x + 44, y + 12, x + 50, y + 24, C.stoneDk); s.line(x + 50, y + 24, x + 47, y + 30, C.stoneDk); }
    if (k < 0.4) { s.line(x + 8, y + 24, x + 16, y + 34, C.stoneDk); s.line(x + 38, y + 4, x + 42, y + 14, C.stoneDk); }
    // tin-crown banner
    s.orect(x + 44, y + 26, 10, 12, C.teal);
    s.rect(x + 47, y + 29, 4, 2, C.crest);
  }
}

// ------------------------------------------------------------------ MG nest: sandbag emplacement w/ gunner
const nestRig = new Rig(24, 24, 12, 20);
const NEST_GUN = bake(fromRows(['gggggggggggG', '.hh.........'], { g: C.gun, G: C.gunHi, h: C.gunSh }));
export class MGNest extends Ent {
  gunner = true;
  gunnerHp = 5;
  aim = Math.PI;
  cd = 90;
  burst = 0;
  bags: Sandbags;
  facing = -1;
  constructor(g: Game, x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.team = 'enemy';
    this.hittable = true;
    this.meleeable = true;
    this.counts = true;
    this.z = 28;
    this.score = 500;
    this.bags = g.add(new Sandbags(x - 8, y, 34));
  }
  box(): Rect | null { return this.gunner ? { x: this.x - 6, y: this.y - 26, w: 12, h: 12 } : null; }
  onHit(g: Game, h: Hit): Mat | null {
    if (!this.gunner || h.from !== 'player') return null;
    this.gunnerHp -= h.kind === 'fire' ? h.dmg * 3 : h.dmg;
    this.flash = 3;
    if (this.gunnerHp <= 0) {
      this.gunner = false;
      this.counts = false;
      this.hittable = false;
      g.kills++;
      g.addScore(this.score, this.x, this.y - 40);
      // the gunner is flung out of his nest
      const s = new Soldier(this.x, this.y - 12, 'rifle', 'none', -1);
      s.helmet = Math.random() < 0.5;
      g.add(s);
      s.die(g, { ...h, kind: h.kind === 'bullet' ? 'heavy' : h.kind, dmg: 99 });
      s.vy = -3.5;
      s.death = 'blast';
      s.vspin = 0.2;
      g.kills--; // counted above
      g.score -= s.score;
    }
    return 'flesh';
  }
  update(g: Game) {
    if (!this.gunner) return;
    const p = g.player;
    const mx = this.x - 4, my = this.y - 18;
    let ta = Math.atan2(p.y - 16 - my, p.x - mx);
    if (ta < 0) ta += Math.PI * 2;
    ta = Math.max(Math.PI - 0.6, Math.min(Math.PI + 0.6, ta));
    // the gun traverses slowly: dodging sideways out-paces it
    // tracks while idle and during the first half of the warning, then locks onto the shown line
    if (this.burst === 0 || this.cd > 118) this.aim += Math.max(-0.025, Math.min(0.025, ta - this.aim));
    if (!g.onScreen(this.x, -10)) return;
    if (--this.cd <= 0 && this.burst === 0) { this.burst = 7; this.cd = 130; }
    if (this.burst > 0 && this.age % 5 === 0 && this.cd < 110) {
      this.burst--;
      const a = this.aim + (Math.random() - 0.5) * 0.08;
      g.add(new EBullet(mx + Math.cos(this.aim) * 12, my + Math.sin(this.aim) * 12, Math.cos(a) * 2.8, Math.sin(a) * 2.8));
      g.snd('gat', this.x, 0.35, 0.75);
      g.fx.shell(this.x, my, -1);
    }
  }
  draw(g: Game, s: Surface) {
    const mx = this.x - 4, my = this.y - 18;
    if (this.gunner) {
      // gunner: helmet + shoulders peeking over the bags
      const o = this.flash > 0 ? { mode: Mode.Flash, color: 0xffffffff } : undefined;
      const tmp = nestRig;
      tmp.begin();
      tmp.limb(v(0, -2), v(0, -8), 6, C.uni);
      tmp.limb(v(-2, -6), v(-7, -4), 2, C.eskin);
      tmp.sprite(HEAD_TIN_CACHE, -5, -18);
      tmp.present(s, this.x + 4, this.y - 8, true, o);
      s.blitRot(NEST_GUN, 1, 1, mx, my, this.aim, {});
      const tele = this.cd < 130 && this.cd > 110 && this.burst > 0;
      if (tele) {
        if (g.t & 2) s.disc(mx + Math.cos(this.aim) * 13, my + Math.sin(this.aim) * 13, 2, C.white);
        aimLine(s, mx, my, this.aim, 220, g.t, this.cd < 118);
      }
      if (this.burst > 0 && this.cd < 110 && (g.t & 2)) s.disc(mx + Math.cos(this.aim) * 14, my + Math.sin(this.aim) * 14, 3, C.fire1);
    }
  }
}
import { HEAD_TIN as HEAD_TIN_CACHE } from './puppet';

export { Gib, bake };

// ------------------------------------------------------------------ Secret: a rusted hatch hiding a prisoner
const HATCH = bake(fromRows(['rrrrrrrrrr', 'rRRRRRRRRr', 'rRbRRRRbRr', 'rRRRRRRRRr', 'rRRRkkRRRr', 'rRRRkkRRRr', 'rRRRRRRRRr', 'rRbRRRRbRr', 'rRRRRRRRRr', 'rrrrrrrrrr'], { r: C.rustSh, R: C.rust, b: C.tinHi, k: C.gunSh }));
export class SecretHatch extends Ent {
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.hp = 8;
    this.hittable = true;
    this.team = 'neutral';
    this.z = 14;
  }
  box(): Rect { return { x: this.x - 6, y: this.y - 16, w: 12, h: 16 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.hp -= h.dmg;
    this.flash = 2;
    if (this.hp <= 0) {
      this.dead = true;
      g.add(new Gib(HATCH, this.x, this.y - 6, h.dx * 2.5, -3, 0.4, 160));
      g.snd('clank', this.x, 0.9, 0.8);
      g.fx.dust(this.x, this.y - 4, 6, 1, C.rustSh);
      g.fx.text(this.x, this.y - 30, 'SECRET!', C.fire1);
      const pow = g.add(new Hostage(this.x + 4, this.y, 'score'));
      pow.free(g);
      g.later(40, () => g.add(new Pickup(this.x + 16, this.y - 10, 'bombs')));
    }
    return 'metal';
  }
  update(_g: Game) {}
  draw(_g: Game, s: Surface) {
    s.blit(HATCH, this.x - 6, this.y - 14, this.flash > 0 ? { mode: Mode.Flash, color: 0xffffffff } : undefined);
    if (this.hp < 5) s.pset(this.x + 1, this.y - 10, C.black);
  }
}
