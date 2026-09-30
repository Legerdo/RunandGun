import { Surface, Mode, fromRows, mix } from '../engine/surface';
import { drawText } from '../engine/font';
import { audio } from '../engine/audio';
import { C } from './palette';
import { Ent, type Hit, type Mat, type Rect } from './types';
import { ik, v, type V, bake } from './puppet';
import { EBullet, Mortar } from './weapons';
import { Gib } from './gib';
import { PT } from './fx';
import { groundZone, lane, aimLine } from './danger';
import type { Game } from './world';

// ------------------------------------------------------------------ helper hazards
// A wave travelling along the ground: shockwave (dust ring) or fire wall. Jump over it.
export class GroundWave extends Ent {
  dir: number;
  spd: number;
  h: number;
  life: number;
  kind: 'shock' | 'fire';
  constructor(x: number, y: number, dir: number, kind: 'shock' | 'fire', spd = 3, h = 14, life = 120) {
    super();
    this.x = x; this.y = y;
    this.dir = dir; this.kind = kind; this.spd = spd; this.h = h; this.life = life;
    this.team = 'enemy';
    this.z = 71;
  }
  update(g: Game) {
    this.x += this.dir * this.spd;
    if (--this.life <= 0 || !g.onScreen(this.x, 10)) { this.dead = true; return; }
    if (this.kind === 'shock') {
      if (this.age % 2 === 0) g.fx.dust(this.x, this.y, 1, this.dir, C.stoneSh);
      if (this.age % 3 === 0) g.fx.debris(this.x, this.y - 2, 1, C.woodSh, 1, 3, 2);
    } else {
      g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 6, y: this.y - Math.random() * this.h, vy: -1.2, life: 14, size: 3 + Math.random() * 2, c: C.fire2 });
      if (this.age % 3 === 0) g.fx.light(this.x, this.y - 10, 30, [140, 50, 10], 4);
    }
    const p = g.player;
    const pb = p.box();
    if (pb && Math.abs(p.x - this.x) < 6 && pb.y + pb.h > this.y - this.h) p.hurt(g, this.x);
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x), y = Math.round(this.y);
    if (this.kind === 'shock') {
      const k = (g.t >> 1) & 1;
      s.othick(x, y - this.h, x - this.dir * 6, y, 2, C.offwhite);
      s.othick(x - this.dir * 3, y - this.h + 4, x - this.dir * 10, y, 1, C.sand);
      if (k) s.pset(x, y - this.h - 1, C.white);
    } else {
      s.disc(x, y - 6, 6, C.fire3);
      s.disc(x, y - 8, 4, C.fire1);
    }
  }
}

// Bubble mine: floats out of the boss's mouth, bounces toward the player, pops.
export class BubbleMine extends Ent {
  constructor(x: number, y: number, vx: number, vy: number) {
    super();
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.team = 'enemy';
    this.hittable = true;
    this.hp = 2;
    this.z = 69;
    this.score = 200;
  }
  box(): Rect { return { x: this.x - 7, y: this.y - 7, w: 14, h: 14 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.hp -= h.dmg;
    this.flash = 2;
    if (this.hp <= 0) {
      this.dead = true;
      g.explode(this.x, this.y, 16, 0, 'player', { scale: 0.9, noScorch: true });
      g.fx.splash(this.x, this.y, 10, 0.6);
      g.addScore(this.score, this.x, this.y - 10);
    }
    return 'glass';
  }
  update(g: Game) {
    this.vy += 0.08;
    this.x += this.vx;
    this.y += this.vy;
    const gy = g.groundAt(this.x, this.y - 8) - 7;
    if (this.y > gy) {
      this.y = gy;
      this.vy = -Math.max(1.4, Math.abs(this.vy) * 0.7);
      this.vx = Math.sign(g.player.x - this.x) * Math.min(1.2, Math.abs(this.vx) + 0.2);
      g.snd('tonk', this.x, 0.3, 0.5);
    }
    const p = g.player;
    const pb = p.box();
    if ((pb && Math.abs(p.x - this.x) < 9 && this.y > pb.y - 4 && this.y < pb.y + pb.h + 4) || this.age > 300) {
      this.dead = true;
      g.explode(this.x, this.y, 24, 1, 'enemy', { scale: 1.1 });
    }
  }
  draw(g: Game, s: Surface) {
    const r = 6 + Math.sin(this.age * 0.2) * 0.6;
    const blink = this.age > 220 && (g.t & 2);
    s.ring(this.x, this.y, r + 1, C.waterSh);
    s.ddisc(this.x, this.y, r, C.water, 0.4);
    s.odisc(this.x, this.y + 1, 3, this.flash > 0 ? C.white : blink ? C.ebul : C.tinSh);
    s.pset(this.x, this.y - 2, C.ebul);
    s.pset(this.x - 3, this.y - 4, C.white);
    s.pset(this.x - 2, this.y - 5, C.white);
  }
}

// Scuttling crab-bot (kamikaze).
export class CrabBot extends Ent {
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.team = 'enemy';
    this.hittable = true;
    this.meleeable = true;
    this.hp = 2;
    this.z = 31;
    this.score = 300;
  }
  box(): Rect { return { x: this.x - 7, y: this.y - 8, w: 14, h: 8 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.hp -= h.dmg;
    this.flash = 2;
    if (this.hp <= 0) {
      this.dead = true;
      g.explode(this.x, this.y - 4, 14, 0, 'player', { scale: 0.8 });
      g.addScore(this.score, this.x, this.y - 12);
      g.kills++;
    }
    return 'metal';
  }
  update(g: Game) {
    this.vy = Math.min(4, this.vy + 0.25);
    this.y += this.vy;
    const gy = g.groundAt(this.x, this.y - 6);
    if (this.y >= gy) { this.y = gy; this.vy = 0; }
    const p = g.player;
    if (this.vy === 0) this.x += Math.sign(p.x - this.x) * 1.3;
    const pb = p.box();
    if (pb && Math.abs(p.x - this.x) < 9 && p.y > this.y - 10 && p.y - 30 < this.y) {
      this.dead = true;
      g.explode(this.x, this.y - 4, 20, 1, 'enemy', { scale: 1 });
    }
  }
  draw(g: Game, s: Surface) {
    const x = Math.round(this.x), y = Math.round(this.y);
    const l = (g.t >> 2) & 1;
    const col = this.flash > 0 ? C.white : C.rust;
    for (let i = -1; i <= 1; i += 2) {
      s.othick(x + i * 4, y - 4, x + i * (8 + l), y, 1, C.rustSh);
      s.othick(x + i * 3, y - 4, x + i * (6 - l), y, 1, C.rustSh);
    }
    s.odisc(x, y - 5, 4, col);
    s.rect(x - 4, y - 5, 9, 2, col);
    s.pset(x - 2, y - 8, (g.t & 4) ? C.ebul : C.white);
    s.pset(x + 2, y - 8, (g.t & 4) ? C.ebul : C.white);
  }
}

// ------------------------------------------------------------------ The Barnacle King
type BState = 'rise' | 'intro' | 'idle' | 'slam' | 'sweepLow' | 'sweepHigh' | 'mortar' | 'bubble' | 'fan' | 'bots' | 'laser' | 'walk' | 'phase' | 'dying';

const ADMIRAL = bake(fromRows([
  '...kkkkk...',
  '..kkkkkkk..',
  '.kkkyykkkk.',
  'kkkkkkkkkkk',
  '...sssss...',
  '..sswswss..',
  '..sssssss..',
  '.mmmmmmmmm.',
  '..mm.s.mm..',
  '..bbbbbbb..',
  '.bbbybbybb.',
], { k: C.black, y: C.crest, s: C.eskin, w: C.white, m: C.offwhite, b: C.blue }));

export class Boss extends Ent {
  st = 0;
  state: BState = 'rise';
  phase = 1;
  clawHp = 75;
  maxBody = 260;
  body = 260;
  bodyY = 0; // squat offset (positive = lower)
  bodyYT = 0;
  riseY = 170;
  wrist: V; // claw wrist world position
  wristT: V;
  clawOpen = 0.3;
  clawAttached = true;
  targetX = 0;
  flashClaw = 0;
  flashBody = 0;
  eyeGlow = 0;
  laserX = 0;
  laserOn = false;
  seq = 0;
  arenaL: number;
  arenaR: number;
  walkT = 0;
  homeX: number;
  gunSpin = 0;
  onDead: (() => void) | null = null;
  domeOff = false;
  adm = { x: 0, y: 0, vx: 0, vy: 0, active: false };
  legPh = 0;

  constructor(x: number, y: number, arenaL: number, arenaR: number) {
    super();
    this.x = x; this.y = y;
    this.homeX = x;
    this.arenaL = arenaL;
    this.arenaR = arenaR;
    this.team = 'enemy';
    this.hittable = false;
    this.counts = true;
    this.z = 32;
    this.score = 50000;
    this.wrist = v(x - 100, y - 60);
    this.wristT = v(x - 100, y - 60);
  }

  // body center in world space
  get bx() { return this.x; }
  get by() { return this.y - 88 + this.bodyY + this.riseY; }

  clawBox(): Rect { return { x: this.wrist.x - 38, y: this.wrist.y - 15, w: 42, h: 28 }; }
  bodyBox(): Rect { return { x: this.bx - 72, y: this.by - 36, w: 144, h: 60 }; }
  domeBox(): Rect { return { x: this.bx - 8, y: this.by - 58, w: 32, h: 24 }; }

  box(): Rect | null {
    if (!this.hittable) return null;
    // union box; precise part test happens in onHit
    const b = this.bodyBox();
    const x0 = Math.min(b.x, this.clawAttached ? this.wrist.x - 34 : b.x);
    return { x: x0, y: b.y - 30, w: b.x + b.w - x0, h: Math.max(b.h + 30, this.clawAttached ? this.wrist.y + 14 - (b.y - 30) : 0) };
  }

  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player' || !this.hittable) return null;
    const inR = (r: Rect, pad = 0) => h.x >= r.x - pad && h.x <= r.x + r.w + pad && h.y >= r.y - pad && h.y <= r.y + r.h + pad;
    const boom = h.kind === 'explosion';
    if (this.clawAttached && inR(this.clawBox(), boom ? 12 : 0)) {
      this.clawHp -= h.dmg;
      this.flashClaw = 4;
      if (this.clawHp <= 0) this.loseClaw(g);
      return 'metal';
    }
    if (this.phase >= 3 && !this.domeOff && inR(this.domeBox(), boom ? 10 : 0)) {
      this.damage(g, h.dmg * 2);
      return 'glass';
    }
    if (inR(this.bodyBox(), boom ? 14 : 0)) {
      if (this.phase === 1) {
        // armored shell: shots glance off (no tint) so the claw reads as the weak point
        this.body -= h.dmg * 0.15;
        if (Math.random() < 0.3) g.fx.sparks(h.x, h.y, 2, -Math.PI / 2 - Math.sign(h.dx) * 0.8, 0.6, 3, C.metalSpark);
        return 'metal';
      }
      const mult = 1;
      // exposed furnace core
      const core = this.phase >= 2 && Math.abs(h.x - (this.bx - 58)) < 14 && Math.abs(h.y - (this.by + 4)) < 14;
      this.damage(g, h.dmg * mult * (core ? 1.6 : 1));
      return 'metal';
    }
    return null;
  }

  damage(g: Game, d: number) {
    this.body -= d;
    this.flashBody = 4;
    if (this.phase === 2 && this.body < this.maxBody * 0.4) {
      this.phase = 3;
      this.state = 'phase';
      this.st = 0;
      audio.voice('boss_rage', { priority: true });
      g.shake(6);
      g.explode(this.bx + 10, this.by - 40, 24, 0, 'player', { scale: 1.4 });
      g.fx.chunks(this.bx, this.by - 40, 8, C.glass, C.white, 4, 1, 3, 4);
    }
    if (this.body <= 0 && this.state !== 'dying') this.die(g);
  }

  loseClaw(g: Game) {
    this.clawAttached = false;
    this.phase = 2;
    this.state = 'phase';
    this.st = 0;
    g.hitstop(12);
    g.flash(5, C.white);
    g.shake(10);
    g.explode(this.wrist.x, this.wrist.y, 40, 0, 'player', { scale: 2.4 });
    g.addScore(10000, this.wrist.x, this.wrist.y - 30);
    // the claw drops onto the pier
    const claw = new Surface(46, 34);
    this.drawClaw(claw, 36, 17, 0.2, C.rust, true);
    g.add(new Gib(bake(claw), this.wrist.x - 12, this.wrist.y, -1.2, -4, -0.12, 400, { bounce: 0.2, smoke: true, z: 36 }));
    // armor plates blow off
    for (let i = 0; i < 4; i++) {
      const plate = new Surface(14, 10);
      plate.clear(C.rust);
      plate.rect(0, 0, 14, 2, C.fire3);
      plate.rect(0, 8, 14, 2, C.rustSh);
      g.add(new Gib(bake(plate), this.bx - 40 + i * 10, this.by - 10, -1.5 - Math.random() * 2, -3 - Math.random() * 3, 0.3, 200));
    }
    audio.voice('boss_hurt', { priority: true });
    g.snd('roar', this.x, 1, 0.8);
  }

  die(g: Game) {
    this.state = 'dying';
    this.st = 0;
    this.hittable = false;
    this.counts = false;
    this.laserOn = false;
    g.kills++;
    g.addScore(this.score);
    g.hitstop(18);
    g.flash(10, C.white);
    g.shake(12);
    g.slowmo(0.35, 150);
    audio.voice('boss_die', { priority: true });
    audio.playSong(null);
    // clear the arena of hazards
    for (const e of g.ents) if (e !== this && e.team === 'enemy') {
      if (e instanceof CrabBot || e instanceof BubbleMine) e.onHit(g, { dmg: 99, kind: 'explosion', x: e.x, y: e.y, dx: -1, dy: 0, force: 1, from: 'player' });
      else if (!e.hittable) e.dead = true;
    }
  }

  next(g: Game) {
    const P1: BState[] = ['slam', 'sweepLow', 'mortar', 'bubble', 'slam', 'sweepHigh', 'mortar', 'sweepLow', 'bubble', 'sweepHigh'];
    const P2: BState[] = ['fan', 'bubble', 'mortar', 'bots', 'walk', 'fan', 'mortar', 'bubble'];
    const P3: BState[] = ['laser', 'fan', 'mortar', 'bubble', 'laser', 'bots', 'fan', 'mortar'];
    const list = this.phase === 1 ? P1 : this.phase === 2 ? P2 : P3;
    this.state = list[this.seq++ % list.length];
    this.st = 0;
    void g;
  }

  update(g: Game) {
    this.st++;
    if (this.flashClaw > 0) this.flashClaw--;
    if (this.flashBody > 0) this.flashBody--;
    const p = g.player;
    const fast = this.phase === 3 ? 1.35 : 1;
    this.gunSpin *= 0.95;
    this.eyeGlow *= 0.9;
    this.legPh += Math.abs(this.x - (this.homeX + this.walkT)) > 1 ? 0.08 : 0;
    // rest pose for the claw
    const restW = v(this.bx - 104, this.y - 56 + this.bodyY * 0.5);
    let clawSpeed = 0.12;

    // damage ambience
    if (this.phase >= 2 && this.state !== 'rise') {
      if (this.age % 4 === 0) g.fx.steam(this.bx - 58, this.by - 8, 1, -1, -0.8);
      if (this.age % 5 === 0) g.fx.sparks(this.bx - 70, this.by - 34, 1, -Math.PI * 0.7, 0.5, 2);
    }
    if (this.phase >= 3 && this.state !== 'dying') {
      if (this.age % 2 === 0) g.fx.add({ t: PT.Fire, x: this.bx + (Math.random() - 0.3) * 90, y: this.by - 24 - Math.random() * 10, vy: -1.3, life: 16, size: 3 + Math.random() * 2, c: C.fire2 });
      if (this.age % 5 === 0) g.fx.smoke(this.bx + (Math.random() - 0.5) * 70, this.by - 40, 1, 6, C.smoke2, 1);
    }

    switch (this.state) {
      case 'rise': {
        // emerges from the sea
        this.riseY = Math.max(0, this.riseY - 0.9);
        g.shake(2.5);
        if (this.st % 6 === 0) g.fx.splash(this.bx + (Math.random() - 0.5) * 140, this.y + 4, 6, 1.2);
        if (this.st % 20 === 0) g.snd('splash', this.x, 0.7, 0.7);
        this.wrist = v(restW.x, restW.y + this.riseY);
        if (this.riseY <= 0) { this.state = 'intro'; this.st = 0; g.snd('roar', this.x, 1); g.shake(8); audio.voice('boss_intro', { priority: true }); }
        return;
      }
      case 'intro':
        this.wristT = v(restW.x + 10, restW.y - 30);
        this.clawOpen = 0.5 + Math.sin(this.st * 0.5) * 0.4;
        if (this.st % 10 === 0) g.snd('clank', this.x, 0.4, 0.6);
        if (this.st > 110) { this.hittable = true; this.next(g); }
        break;
      case 'idle':
        this.wristT = restW;
        if (this.st > 30 / fast) this.next(g);
        break;
      case 'phase':
        this.wristT = restW;
        this.bodyYT = 10;
        if (this.st % 6 === 0) g.explode(this.bx + (Math.random() - 0.5) * 100, this.by + (Math.random() - 0.5) * 40, 18, 0, 'player', { scale: 1, silent: this.st % 12 !== 0 });
        if (this.st > 70) { this.bodyYT = 0; this.state = 'idle'; this.st = 0; }
        break;
      case 'slam': {
        if (this.st < 36 / fast) {
          if (this.st < 26 / fast) this.targetX = Math.max(this.arenaL + 20, Math.min(this.bx - 90, p.x));
          this.wristT = v(this.targetX + 16, this.y - 150);
          clawSpeed = 0.18;
          this.clawOpen = 0.8;
        } else if (this.st < 42 / fast) {
          this.wristT = v(this.targetX + 16, this.y - 12);
          clawSpeed = 0.6;
          this.clawOpen = 0.1;
        } else if (this.st < 44 / fast + 1 && this.st >= 42 / fast) {
          if (!this.slammed) {
            this.slammed = true;
            g.shake(9);
            g.hitstop(3);
            g.snd('slam', this.targetX, 1);
            g.fx.dust(this.targetX, this.y, 16, 0, C.stoneSh);
            g.fx.chunks(this.targetX, this.y - 4, 6, C.wood, C.woodHi, 7, 2, 3, 4);
            g.add(new GroundWave(this.targetX - 20, this.y, -1, 'shock', 3.2 * fast, 14));
            g.add(new GroundWave(this.targetX + 20, this.y, 1, 'shock', 3.2 * fast, 14));
            const pb = p.box();
            if (pb && Math.abs(p.x - this.targetX) < 22) p.hurt(g, this.targetX);
          }
        } else {
          this.wristT = v(this.targetX + 16, this.y - 12);
          if (this.st > 80 / fast) { this.slammed = false; this.state = 'idle'; this.st = 0; }
        }
        break;
      }
      case 'sweepLow':
      case 'sweepHigh': {
        const hy = this.state === 'sweepLow' ? this.y - 11 : this.y - 36;
        if (this.st < 40 / fast) {
          // wind-up: pull the claw back beside the body, snapping
          this.wristT = v(this.bx - 60, hy);
          this.clawOpen = 0.5 + Math.sin(this.st * 0.8) * 0.45;
          if (this.st % 8 === 0) g.snd('clank', this.x, 0.5, this.state === 'sweepLow' ? 0.6 : 1.1);
        } else if (this.st < 78 / fast) {
          this.wristT = v(this.arenaL - 10, hy);
          clawSpeed = 0.09 * fast;
          this.clawOpen = 0.9;
          if (this.st % 3 === 0) g.fx.dust(this.wrist.x - 20, this.y, 1, -1, C.stoneSh);
          const pb = p.box();
          const cb = this.clawBox();
          if (pb && pb.x < cb.x + cb.w && pb.x + pb.w > cb.x && pb.y < cb.y + cb.h - 4 && pb.y + pb.h > cb.y + 4) p.hurt(g, this.wrist.x);
        } else {
          this.wristT = restW;
          clawSpeed = 0.08;
          if (this.st > 110 / fast) { this.state = 'idle'; this.st = 0; }
        }
        break;
      }
      case 'mortar': {
        const n = this.phase === 3 ? 5 : 3;
        if (this.st % 12 === 0 && this.st <= 12 * n && this.st > 0) {
          const sx = this.bx + 30 + (this.st / 12) % 2 * 14, sy = this.by - 58;
          g.fx.smoke(sx, sy, 3, 4, C.smoke1, 1);
          g.fx.light(sx, sy, 20, [200, 120, 40], 4);
          g.snd('thoomp', this.x, 0.8);
          const i = this.st / 12 - 1;
          const tx = Math.max(this.arenaL + 10, Math.min(this.bx - 60, p.x + (i - (n - 1) / 2) * 40 + p.vx * 20));
          g.add(new Mortar(tx, this.y, 56 + i * 6, 24));
        }
        if (this.st > 12 * n + 50) { this.state = 'idle'; this.st = 0; }
        break;
      }
      case 'bubble': {
        // anticipation: rise and vent steam downward, then squat so the face drops into
        // horizontal fire range (an opening to punish). Standing under the belly is not safe.
        if (this.st < 26) {
          this.bodyYT = -8;
          if (this.st % 3 === 0) g.fx.steam(this.bx - 40 + Math.random() * 80, this.by + 26, 1, 0, 1.4);
          if (this.st === 1) g.snd('steam', this.x, 0.8, 0.8);
          break;
        }
        this.bodyYT = 44;
        this.wristT = v(this.bx - 40, this.y - 30);
        if (this.st > 30 && this.st < 110 && this.st % (this.phase === 3 ? 18 : 26) === 0) {
          const mx = this.bx - 72, my = this.by + 6;
          g.add(new BubbleMine(mx, my, -1.2 - Math.random() * 1.2, -2 - Math.random()));
          g.snd('splash', this.x, 0.35, 1.8);
        }
        if (this.st > 150) { this.bodyYT = 0; this.state = 'idle'; this.st = 0; }
        break;
      }
      case 'fan': {
        // belly gatling: fans with gaps, alternating offsets
        this.gunSpin = Math.min(1, this.gunSpin + 0.1);
        if (this.st === 1) g.snd('charge', this.x, 0.6, 1.2);
        const waves = this.phase === 3 ? 5 : 4;
        if (this.st > 36 && (this.st - 36) % 22 === 0 && (this.st - 36) / 22 < waves) {
          const k = (this.st - 36) / 22;
          const mx = this.bx - 76, my = this.by + 22;
          const base = Math.atan2(p.y - 14 - my, p.x - mx);
          for (let i = -2; i <= 2; i++) {
            const a = base + i * 0.2 + (k % 2 ? 0.1 : 0);
            g.add(new EBullet(mx, my, Math.cos(a) * 2.2, Math.sin(a) * 2.2, 2));
          }
          g.snd('gat', this.x, 0.6, 0.7);
          g.fx.light(mx, my, 24, [200, 80, 80], 4);
        }
        if (this.st > 36 + waves * 22 + 30) { this.state = 'idle'; this.st = 0; }
        break;
      }
      case 'bots': {
        if (this.st === 20 || this.st === 40 || this.st === 60) {
          g.add(new CrabBot(this.bx - 40 - this.st * 0.5, this.by + 20));
          g.snd('clank', this.x, 0.5, 1.4);
        }
        if (this.st > 90) { this.state = 'idle'; this.st = 0; }
        break;
      }
      case 'walk': {
        // lumber forward, then back: pressure without a hit
        this.walkT = this.st < 90 ? -50 : 0;
        if (this.st % 30 === 15) { g.shake(3); g.snd('slam', this.x, 0.35, 1.4); }
        if (this.st > 170) { this.state = 'idle'; this.st = 0; }
        break;
      }
      case 'laser': {
        // eyes charge, then a fire wall sweeps along the pier toward the boss: jump over it
        this.bodyYT = 16;
        if (this.st < 60) {
          this.eyeGlow = Math.min(1, this.st / 50);
          if (this.st === 2) g.snd('charge', this.x, 0.8);
          this.laserX = this.arenaL + 4;
        } else if (this.st < 60 + 130) {
          this.laserOn = true;
          this.eyeGlow = 1;
          this.laserX += 2.1;
          if (this.st % 8 === 0) g.snd('laser', this.x, 0.35);
          g.fx.add({ t: PT.Fire, x: this.laserX + (Math.random() - 0.5) * 6, y: this.y - Math.random() * 16, vy: -1.4, life: 16, size: 3 + Math.random() * 2, c: C.fire2 });
          if (this.st % 3 === 0) g.fx.light(this.laserX, this.y - 10, 34, [200, 60, 30], 4);
          if (this.st % 4 === 0) g.fx.decals.push({ x: this.laserX, y: this.y + 1, kind: 'scorch', r: 6, seed: 1 });
          const pb = p.box();
          if (pb && Math.abs(p.x - this.laserX) < 7 && pb.y + pb.h > this.y - 20) p.hurt(g, this.laserX);
          if (this.laserX > this.bx - 44) this.st = 200;
        } else {
          this.laserOn = false;
          this.bodyYT = 0;
          if (this.st > 220) { this.state = 'idle'; this.st = 0; }
        }
        break;
      }
      case 'dying':
        return this.updateDying(g);
    }
    // physical easing
    this.bodyY += (this.bodyYT - this.bodyY) * 0.08;
    const tx = this.homeX + this.walkT;
    this.x += Math.max(-0.5, Math.min(0.5, tx - this.x));
    if (this.clawAttached) {
      this.wrist = v(this.wrist.x + (this.wristT.x - this.wrist.x) * clawSpeed, this.wrist.y + (this.wristT.y - this.wrist.y) * clawSpeed);
    }
    // touching the body/claw is dangerous
    const pb = p.box();
    if (pb && this.state !== 'intro') {
      const bb = this.bodyBox();
      if (pb.x + pb.w > bb.x + 10 && pb.y < bb.y + bb.h && pb.y + pb.h > bb.y) p.hurt(g, this.bx);
      // the player may duck under the front of the belly to shoot straight up
      if (p.x > this.bx - 50) p.x = this.bx - 50;
    }
  }
  private slammed = false;

  updateDying(g: Game) {
    const t = this.st;
    this.bodyYT = Math.min(80, t * 0.4);
    this.bodyY += (this.bodyYT - this.bodyY) * 0.05;
    if (t % 5 === 0 && t < 220) {
      const b = this.bodyBox();
      g.explode(b.x + Math.random() * b.w, b.y + Math.random() * b.h, 22 + Math.random() * 16, 0, 'player', { scale: 1.2 + Math.random(), silent: t % 10 !== 0, noScorch: true });
      if (t % 15 === 0) g.fx.chunks(this.bx, this.by, 4, C.rust, C.fire3, 9, 3, 5, 6);
    }
    if (t === 60) {
      this.domeOff = true;
      this.adm = { x: this.bx + 6, y: this.by - 44, vx: 1.6, vy: -6, active: true };
      g.snd('clank', this.x, 1, 1.3);
      g.fx.chunks(this.bx + 6, this.by - 44, 10, C.glass, C.white, 4, 1, 3, 5);
    }
    if (this.adm.active) {
      this.adm.vy += 0.12;
      this.adm.x += this.adm.vx;
      this.adm.y += this.adm.vy;
      if (this.adm.y > this.y + 40) {
        this.adm.active = false;
        g.fx.splash(this.adm.x, this.y + 2, 16, 1);
        g.snd('splash', this.adm.x, 0.6, 1.4);
      }
    }
    if (t === 230) {
      g.explode(this.bx, this.by, 90, 0, 'player', { scale: 4.5, noScorch: true });
      g.flash(24, C.white);
      g.shake(14);
      g.hitstop(12);
      g.fx.splash(this.bx, this.y + 2, 80, 3);
      g.snd('splash', this.x, 1, 0.6);
      audio.play('expl_l', { vol: 1, pitch: 0.7 });
    }
    if (t > 230 && t % 3 === 0) g.fx.splash(this.bx + (Math.random() - 0.5) * 120, this.y + 2, 4, 1.4);
    if (t === 330) {
      this.dead = true;
      if (this.onDead) this.onDead();
    }
  }

  // ------------------------------------------------------------------ drawing
  private drawClaw(s: Surface, wx: number, wy: number, open: number, col: number, detached = false) {
    // pincer pointing left from the wrist
    const sh = mix(col, C.black, 0.4);
    const hi = mix(col, C.white, 0.25);
    s.odisc(wx - 6, wy, 9, col);
    s.disc(wx - 8, wy - 3, 5, hi);
    // upper jaw
    const a = -0.25 - open * 0.45;
    const ux = wx - 12, uy = wy - 3;
    for (let i = 0; i < 4; i++) {
      const k = i / 3;
      s.othick(ux - Math.cos(a) * 8 * i, uy + Math.sin(a) * 8 * i - k * k * 4, ux - Math.cos(a) * 8 * (i + 1), uy + Math.sin(a) * 8 * (i + 1) - k * 3, 6 - i, i % 2 ? sh : col);
    }
    // lower jaw
    const b = 0.2 + open * 0.4;
    const lx = wx - 12, ly = wy + 3;
    for (let i = 0; i < 3; i++) {
      s.othick(lx - Math.cos(b) * 7 * i, ly + Math.sin(b) * 7 * i, lx - Math.cos(b) * 7 * (i + 1), ly + Math.sin(b) * 7 * (i + 1) + i, 5 - i, sh);
    }
    // barnacles
    s.odisc(wx - 2, wy - 7, 1.5, C.offwhite);
    s.odisc(wx + 3, wy - 2, 1, C.offwhite);
    if (detached) { s.disc(wx + 5, wy, 3, C.fire4); s.disc(wx + 5, wy, 1.5, C.fire2); }
  }

  draw(g: Game, s: Surface) {
    const bx = Math.round(this.bx), by = Math.round(this.by);
    const fB = this.flashBody > 0, fC = this.flashClaw > 0;
    // hits tint the struck part instead of a full white flash (big sprites flashing white is noisy)
    const flick = (g.t & 2) === 0;
    const T = (c: number, f: boolean) => (f && flick ? mix(c, C.white, 0.4) : c);
    const shellC = T(C.rust, fB), shellSh = T(C.rustSh, fB), shellHi = T(C.fire3, fB), dark = T(C.stoneDk, fB);
    const gy = this.y;
    const ph = this.legPh;

    // --- legs: crab legs arch above the hip and stab down into the pier / water
    type Leg = { hip: V; foot: V; back: boolean };
    const back: Leg[] = [
      { hip: v(bx + 22, by + 14), foot: v(this.x + 98 + Math.sin(ph) * 5, gy + 2), back: true },
      { hip: v(bx - 18, by + 16), foot: v(this.x - 44 - Math.sin(ph) * 5, gy + 2), back: true },
    ];
    const front: Leg[] = [
      { hip: v(bx - 38, by + 18), foot: v(this.x - 80 + Math.sin(ph + 1) * 5, gy), back: false },
      { hip: v(bx + 30, by + 20), foot: v(this.x + 72 - Math.sin(ph + 2) * 5, gy), back: false },
      { hip: v(bx + 58, by + 12), foot: v(this.x + 128 + Math.sin(ph + 1) * 5, gy), back: false },
    ];
    const drawLeg = (L: Leg) => {
      const bend = L.foot.x < L.hip.x ? 1 : -1;
      const knee = ik(L.hip, L.foot, 44, 46, bend);
      const mid = v(knee.x + (L.foot.x - knee.x) * 0.55, knee.y + (L.foot.y - knee.y) * 0.55);
      const c1 = L.back ? dark : shellSh, c2 = L.back ? dark : shellC;
      s.othick(L.hip.x, L.hip.y, knee.x, knee.y, L.back ? 8 : 11, c1);
      s.othick(knee.x, knee.y, mid.x, mid.y, L.back ? 6 : 8, c2);
      s.othick(mid.x, mid.y, L.foot.x, L.foot.y - 3, L.back ? 4 : 5, c2);
      s.odisc(knee.x, knee.y, L.back ? 5 : 6, L.back ? dark : shellHi);
      if (!L.back) {
        s.pset(knee.x - 2, knee.y - 3, C.offwhite);
        s.odisc(mid.x, mid.y, 3, shellSh);
        s.odisc(knee.x + 3, knee.y - 5, 1.5, C.offwhite);
      }
      s.othick(L.foot.x, L.foot.y - 4, L.foot.x + (bend > 0 ? -2 : 2), L.foot.y + 1, 2, C.gunSh);
    };
    for (const L of back) drawLeg(L);

    // --- smokestacks (mortar tubes)
    for (const [ox, h] of [[34, 28], [50, 22]] as [number, number][]) {
      s.orect(bx + ox - 4, by - 30 - h, 8, h, T(C.steelSh, fB));
      s.rect(bx + ox - 3, by - 30 - h, 2, h, T(C.steel, fB));
      s.orect(bx + ox - 5, by - 33 - h, 10, 3, C.gunSh);
      if (this.phase >= 2) s.rect(bx + ox - 2, by - 29 - h, 4, 2, (g.t & 4) ? C.fire2 : C.fire3);
      else if ((g.t >> 4) & 1) s.pset(bx + ox, by - 34 - h, C.ebul);
    }
    // --- dome with the admiral
    if (!this.domeOff) {
      const dx = bx + 8, dy = by - 40;
      s.blit(ADMIRAL, dx - 6, dy - 12);
      s.ring(dx, dy - 6, 16, fB ? C.white : C.glassSh, 2);
      s.ddisc(dx, dy - 6, 15, C.glass, 0.25);
      s.pset(dx - 8, dy - 16, C.white); s.pset(dx - 7, dy - 17, C.white); s.pset(dx - 9, dy - 14, C.white);
      if (this.phase >= 3) { s.line(dx + 4, dy - 20, dx + 10, dy - 10, C.white); s.line(dx + 10, dy - 10, dx + 6, dy - 4, C.white); }
      s.orect(dx - 17, dy + 6, 34, 4, T(C.steel, fB));
    }
    if (this.adm.active) s.blitRot(ADMIRAL, 6, 6, this.adm.x, this.adm.y, this.st * 0.3);

    // --- carapace: a wide dome over a tapering belly
    const RX = 72, TOP = 42;
    const dome = (inset: number, col: number, ox = 0, oy = 0) => {
      const Tt = TOP - inset, R = RX - inset;
      for (let yy = -Tt; yy <= 24 - inset; yy++) {
        const hw = yy < 0 ? R * Math.sqrt(Math.max(0, 1 - (yy / Tt) * (yy / Tt))) : R - yy * 1.1;
        if (hw <= 0) continue;
        s.rect(bx + ox - hw, by + oy + yy, hw * 2, 1, col);
      }
    };
    dome(-1, C.outline);
    dome(0, shellC);
    for (let yy = 3; yy <= 24; yy++) { const hw = RX - yy * 1.1; s.rect(bx - hw, by + yy, hw * 2, 1, yy > 17 ? dark : shellSh); }
    dome(9, shellHi, -7, -6);
    dome(11, shellC, 4, 3);
    s.disc(bx - 34, by - 28, 4, T(mix(C.fire3, C.white, 0.35), fB));
    s.disc(bx - 25, by - 34, 2, T(mix(C.fire3, C.white, 0.35), fB));
    // segment grooves + rivet band
    for (const k of [-0.45, 0.05, 0.5]) s.line(bx + k * RX, by - TOP + 6 + Math.abs(k) * 14, bx + k * RX * 1.1, by + 2, shellSh);
    s.rect(bx - RX + 2, by - 1, RX * 2 - 4, 3, dark);
    for (let i = -RX + 6; i < RX - 4; i += 8) s.pset(bx + i, by, C.tinHi);
    // barnacle clusters
    for (const [ox, oy, r] of [[22, -36, 3], [30, -32, 2], [-34, -38, 2], [46, -18, 3], [54, -24, 2], [-4, -46, 2], [60, -8, 2]] as [number, number, number][]) {
      s.odisc(bx + ox, by + oy, r, C.offwhite);
      s.pset(bx + ox, by + oy, C.stoneSh);
    }
    // crown crest
    s.orect(bx - 40, by - 42, 10, 8, C.crest);
    s.rect(bx - 38, by - 46, 2, 4, C.crest);
    s.rect(bx - 34, by - 46, 2, 4, C.crest);
    // --- face: eyes on stalks
    const eyes = [v(bx - 52, by - 50), v(bx - 36, by - 56)];
    for (const e of eyes) {
      s.othick(e.x + 5, by - 34, e.x, e.y + 4, 3, shellSh);
      s.odisc(e.x, e.y, 5, C.offwhite);
      const glow = this.eyeGlow;
      s.disc(e.x - 2, e.y, 2.5, glow > 0.2 ? ((g.t & 2) ? C.ebul : C.fire1) : C.black);
      if (this.phase >= 2 && glow <= 0.2) s.pset(e.x - 3, e.y - 1, C.white);
      if (glow > 0.3) s.glow(e.x, e.y, 14 + glow * 10, 160 * glow, 30 * glow, 30 * glow);
    }
    // --- face armor (phase 1) or exposed furnace core (phase 2+)
    if (this.phase === 1) {
      s.orect(bx - 74, by - 12, 26, 30, T(C.steel, fB));
      s.rect(bx - 74, by - 12, 26, 2, T(C.steelHi, fB));
      for (const [px, py] of [[-71, -8], [-52, -8], [-71, 12], [-52, 12]]) s.pset(bx + px, by + py, C.tinHi);
    } else {
      const cx = bx - 58, cy = by + 4;
      for (let i = 0; i < 4; i++) s.othick(cx - 10 + i * 6, cy - 16, cx - 6 + i * 5, cy - 4, 1, C.steelSh);
      s.odisc(cx, cy, 11, C.gunSh);
      s.disc(cx, cy, 8, (g.t & 4) ? C.fire2 : C.fire3);
      s.disc(cx - 1, cy - 1, 4, C.fire1);
      s.glow(cx, cy, 30, 130, 60, 10);
    }
    // mouth grille + bubble cannon
    const mx = bx - 70, my = by + 6;
    s.orect(mx - 4, my - 6, 14, 14, C.gunSh);
    for (let i = 0; i < 3; i++) s.rect(mx - 3, my - 4 + i * 4, 12, 1, C.black);
    if (this.state === 'bubble' && (g.t & 4)) s.disc(mx, my, 4, C.water);
    // belly gatling
    const gx = bx - 64, gyy = by + 22;
    s.orect(gx - 2, gyy - 4, 14, 8, C.gun);
    const spin = (this.age * this.gunSpin * 0.8) % 3;
    for (let i = 0; i < 3; i++) s.rect(gx - 11, gyy - 3 + ((i + Math.floor(spin)) % 3) * 2, 10, 1, i === 0 ? C.gunHi : C.gunSh);
    if (this.state === 'fan' && this.st < 36 && (g.t & 2)) s.pset(gx - 12, gyy, C.white);

    // --- front legs
    for (const L of front) drawLeg(L);

    // --- claw arm
    if (this.clawAttached) {
      const sh = v(bx - 54, by + 10);
      const elbow = ik(sh, this.wrist, 48, 50, this.wrist.y < sh.y ? -1 : 1);
      const armC = T(C.rust, fC);
      s.othick(sh.x, sh.y, elbow.x, elbow.y, 12, T(C.rustSh, fC));
      s.odisc(elbow.x, elbow.y, 8, armC);
      s.pset(elbow.x - 3, elbow.y - 3, C.fire3);
      s.odisc(elbow.x + 2, elbow.y - 5, 1.5, C.offwhite);
      s.othick(elbow.x, elbow.y, this.wrist.x, this.wrist.y, 10, armC);
      s.othick(elbow.x, elbow.y - 2, this.wrist.x, this.wrist.y - 3, 2, T(C.fire3, fC));
      this.drawClaw(s, Math.round(this.wrist.x + 6), Math.round(this.wrist.y), this.clawOpen, T(C.rust, fC));
      // slam: impact zone under the raised claw (the zone is the real hit width)
      const fast = this.phase === 3 ? 1.35 : 1;
      if (this.state === 'slam' && this.st < 42 / fast) {
        s.ddisc(this.targetX, gy - 1, 10 + (this.st / (42 / fast)) * 10, C.black, 0.45);
        // hit test is |player.x - target| < 22, i.e. the body touching ±16
        groundZone(s, this.targetX, 16, gy, g.t, Math.min(1, this.st / (40 / fast)));
      }
      // claw sweeps: the lane is exactly the band the claw passes through
      if ((this.state === 'sweepLow' || this.state === 'sweepHigh') && this.st < 78 / fast) {
        const low = this.state === 'sweepLow';
        const y0 = low ? gy - 22 : gy - 47, y1 = low ? gy : gy - 27;
        const right = this.st < 40 / fast ? this.bx - 64 : this.wrist.x - 38;
        lane(s, this.arenaL + 2, right, y0, y1, g.t, -1, Math.min(1, this.st / (40 / fast)));
      }
    } else {
      // sparking stump
      s.odisc(bx - 56, by + 10, 8, C.rustSh);
      s.disc(bx - 58, by + 10, 3, (g.t & 2) ? C.fire1 : C.fire3);
    }
    // fan: short aim lines for each wave just before it fires
    if (this.state === 'fan') {
      const waves = this.phase === 3 ? 5 : 4;
      const mx = this.bx - 76, my = this.by + 22;
      const p = g.player;
      for (let k = 0; k < waves; k++) {
        const until = 36 + k * 22 - this.st;
        if (until <= 0 || until > 14) continue;
        const base = Math.atan2(p.y - 14 - my, p.x - mx);
        for (let i = -2; i <= 2; i++) aimLine(s, mx, my, base + i * 0.2 + (k % 2 ? 0.1 : 0), 70, g.t, until < 7);
      }
    }
    // laser: the fire wall's path along the pier (jump over it)
    if (this.state === 'laser' && this.st < 60 + 130 && this.st < 200) {
      const from = this.st < 60 ? this.arenaL + 2 : this.laserX + 6;
      lane(s, from, this.bx - 44, gy - 20, gy, g.t, 1, Math.min(1, this.st / 60));
    }
    // --- laser beams
    if (this.laserOn) {
      for (const e of eyes) {
        s.thick(e.x - 2, e.y, this.laserX, gy - 4, 3, C.ebul);
        s.line(e.x - 2, e.y, this.laserX, gy - 4, C.white);
      }
      s.disc(this.laserX, gy - 6, 7, C.fire2);
      s.disc(this.laserX, gy - 7, 4, C.white);
    }
    if (this.state === 'rise') s.drect(bx - 150, gy - 2, 300, 6, C.waterHi, 0.5);
  }

  // HP fraction for the HUD bar
  hpFrac() {
    if (this.phase === 1) return 0.5 + 0.5 * Math.max(0, this.clawHp / 75);
    return 0.5 * Math.max(0, this.body / this.maxBody);
  }
}
