import { Surface, Mode, fromRows, type BlitOpts } from '../engine/surface';
import { drawText } from '../engine/font';
import { audio } from '../engine/audio';
import { C } from './palette';
import { Ent, type Hit, type Mat, type Rect } from './types';
import { Rig, ik, v, type V, HEAD_TIN, HEAD_TIN_SURPRISE, HEAD_TIN_HURT, HEAD_TIN_DEAD, HEAD_TIN_BALD, HELMET_TIN, HEAD_RUSHER, bake } from './puppet';
import { EBullet, Grenade, ERocket } from './weapons';
import { Gib } from './gib';
import { PT } from './fx';
import { groundZone } from './danger';
import type { Body, Game } from './world';

export type Role = 'rifle' | 'grenadier' | 'shield' | 'bazooka' | 'rusher';
export type Idle = 'stand' | 'chat' | 'sleep' | 'eat' | 'patrol' | 'sunbathe' | 'none';
type SState = 'idle' | 'alert' | 'combat' | 'windup' | 'recover' | 'flinch' | 'panic' | 'burn' | 'dying' | 'enter' | 'bash' | 'stumble' | 'leap';
type Death = 'shot' | 'blast' | 'burn' | 'slash' | 'fling';

const rig = new Rig(72, 64, 36, 54);
const HELMET_GIB = bake(HELMET_TIN);
const SHIELD_GIB = bake(fromRows([
  'mmmmmm', 'mMMMMm', 'mMddMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mMMMMm', 'mmmmmm',
], { m: C.steelSh, M: C.steel, d: C.black }));

let screamCd = 0;

// ------------------------------------------------------------------ falling bomb (from gyros)
export class EBomb extends Ent {
  constructor(x: number, y: number, vx = 0) {
    super();
    this.x = x; this.y = y; this.vx = vx;
    this.team = 'enemy';
    this.hittable = true;
    this.z = 70;
    this.score = 50;
  }
  box(): Rect { return { x: this.x - 3, y: this.y - 4, w: 6, h: 8 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player') return null;
    this.dead = true;
    g.explode(this.x, this.y, 14, 0, 'player', { scale: 0.8, noScorch: true });
    g.addScore(this.score, this.x, this.y - 10);
    return 'metal';
  }
  update(g: Game) {
    this.vy = Math.min(4, this.vy + 0.12);
    this.vx *= 0.98;
    this.x += this.vx;
    this.y += this.vy;
    const gy = g.groundAt(this.x, this.y - 4);
    const pb = g.player.box();
    if (this.y >= gy || (pb && this.x > pb.x && this.x < pb.x + pb.w && this.y > pb.y && this.y < pb.y + pb.h)) {
      this.dead = true;
      g.explode(this.x, Math.min(this.y, gy) - 4, 22, 1, 'enemy', { scale: 1 });
    }
  }
  draw(g: Game, s: Surface) {
    // landing marker: where it will burst (reach = 0.75 × 22)
    const gy = g.groundAt(this.x, this.y - 4);
    if (gy < 9999) {
      const lx = this.x + this.vx * Math.max(0, (gy - this.y) / Math.max(1, this.vy + 2));
      groundZone(s, lx, 16, gy, g.t, Math.max(0, Math.min(1, 1 - (gy - this.y) / 150)));
    }
    s.odisc(this.x, this.y, 3, C.tinSh);
    s.pset(this.x - 1, this.y - 1, C.tinHi);
    s.othick(this.x - 2, this.y - 6, this.x + 2, this.y - 6, 1, C.ebul);
    if ((g.t >> 2) & 1) s.pset(this.x, this.y + 1, C.ebul);
  }
}

// ------------------------------------------------------------------ Gyrocopter trooper
const gyroRig = new Rig(56, 48, 28, 30);
export class Gyro extends Ent {
  state: 'enter' | 'hover' | 'drop' | 'leave' | 'crash' = 'enter';
  st = 0;
  baseY: number;
  offX: number;
  bombs = 0;
  bombCd = 70;
  spin = 0;
  facing = -1;
  tilt = 0;
  maxBombs: number;
  constructor(x: number, y: number, maxBombs = 3) {
    super();
    this.x = x; this.y = y; this.baseY = y;
    this.team = 'enemy';
    this.hittable = true;
    this.counts = true;
    this.hp = 7;
    this.z = 48;
    this.score = 500;
    this.offX = 30 + Math.random() * 60;
    this.maxBombs = maxBombs;
  }
  box(): Rect | null { return this.state === 'crash' ? null : { x: this.x - 11, y: this.y - 10, w: 22, h: 16 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (this.state === 'crash' || h.from !== 'player') return null;
    this.hp -= h.dmg;
    this.flash = 3;
    this.x += h.dx * 0.6;
    if (this.hp <= 0) {
      this.state = 'crash';
      this.st = 0;
      this.hittable = false;
      this.counts = false;
      this.vx = h.dx * 1.2 + this.facing * 0.5;
      this.vy = -1.5;
      g.kills++;
      g.addScore(this.score, this.x, this.y - 20);
      g.explode(this.x, this.y, 12, 0, 'player', { scale: 0.8, noScorch: true });
      // the pilot bails out, flailing
      const s = new Soldier(this.x, this.y, 'rifle', 'none', this.facing);
      s.origin = 'bail';
      s.state = 'panic';
      s.vy = -3.5;
      s.vx = -this.vx;
      s.onGround = false;
      s.counts = false;
      g.add(s);
    }
    return 'metal';
  }
  update(g: Game) {
    this.st++;
    const p = g.player;
    if (this.state === 'crash') {
      this.vy += 0.12;
      this.x += this.vx;
      this.y += this.vy;
      this.spin += 0.3;
      if (this.st % 2 === 0) g.fx.smoke(this.x, this.y, 1, 3, C.smoke2, 0.3);
      g.fx.add({ t: PT.Fire, x: this.x, y: this.y, life: 8, size: 3, c: C.fire2 });
      if (this.y >= g.groundAt(this.x, this.y - 10) - 4) {
        this.dead = true;
        g.explode(this.x, this.y - 6, 30, 6, 'player', { scale: 1.6 });
        g.fx.chunks(this.x, this.y - 6, 8, C.tin, C.tinHi, 7, 2, 3, 5);
      }
      return;
    }
    this.flashOnScreen(g);
    const tx = p.x + this.offX;
    const ty = this.baseY + Math.sin(this.st * 0.05) * 6;
    if (this.state === 'enter') {
      this.x += Math.max(-2.2, Math.min(2.2, (tx - this.x) * 0.05));
      this.y += (ty - this.y) * 0.05;
      if (Math.abs(tx - this.x) < 20) { this.state = 'hover'; this.st = 0; }
    } else if (this.state === 'hover') {
      this.vx += Math.max(-0.05, Math.min(0.05, (tx - this.x) * 0.004));
      this.vx *= 0.97;
      this.x += this.vx;
      this.y += (ty - this.y) * 0.08;
      if (--this.bombCd <= 0 && Math.abs(p.x - this.x) < 60) { this.state = 'drop'; this.st = 0; }
    } else if (this.state === 'drop') {
      this.vx *= 0.9;
      this.x += this.vx;
      if (this.st === 18) {
        g.add(new EBomb(this.x, this.y + 6, this.vx));
        g.snd('throw', this.x, 0.4, 0.6);
        this.bombs++;
      }
      if (this.st > 30) {
        this.bombCd = 80 + Math.random() * 40;
        this.offX = (Math.random() < 0.5 ? -1 : 1) * (30 + Math.random() * 60);
        this.state = this.bombs >= this.maxBombs ? 'leave' : 'hover';
        this.st = 0;
      }
    } else if (this.state === 'leave') {
      this.x -= 2;
      this.y -= 0.6;
      if (this.x < g.cam.x - 40 || this.y < -40) this.dead = true;
    }
    this.facing = p.x < this.x ? -1 : 1;
    this.tilt = Math.max(-0.25, Math.min(0.25, this.vx * 0.15));
    if (this.age % 20 === 0) g.snd('heli', this.x, 0.15, 1.6);
  }
  private flashOnScreen(_g: Game) {}
  draw(g: Game, s: Surface) {
    const R = gyroRig;
    R.begin();
    const t = g.t;
    // tail boom and rotor mast
    R.limb(v(-4, 0), v(-18, -3), 2, C.tinSh);
    R.limb(v(-18, -3), v(-18, -8), 2, C.tinSh);
    R.px(-18, -9 + (t & 1), C.white);
    R.limb(v(0, -6), v(0, -14), 1, C.gunSh);
    // pilot
    R.sprite(HEAD_TIN, -4, -16);
    R.limb(v(0, -6), v(5, 3), 2, C.epants);
    // pod
    R.odisc(0, 0, 7, C.tin);
    R.disc(-2, -2, 4, C.tinHi);
    R.rect(3, -4, 4, 4, C.glass);
    R.px(4, -4, C.white);
    R.rect(-6, 4, 12, 2, C.tinSh);
    if (this.state === 'drop' && this.st < 18) R.odisc(0, 8, 2, C.ebul);
    // rotor (motion-blurred)
    const L = [22, 14, 20, 8][(t >> 1) & 3];
    R.bare(v(-L, -15), v(L, -15), 1, C.gunSh);
    R.bare(v(-L + 2, -16), v(L - 2, -16), 1, C.steelHi);
    const o = this.flash > 0 ? { mode: Mode.Flash, color: 0xffffffff } : undefined;
    R.presentRot(s, this.x, this.y, 0, this.state === 'crash' ? this.spin : this.tilt, this.facing > 0, o);
  }
}

export class Soldier extends Ent implements Body {
  role: Role;
  w = 12;
  h = 28;
  onGround = false;
  dropT = 0;
  wall = 0;
  facing = -1;
  state: SState = 'idle';
  st = 0;
  idle: Idle;
  cd = 60;
  aimA = 0;
  kneel = false;
  duck = false;
  cover = false;
  helmet = true;
  burnAcc = 0;
  onFire = 0;
  death: Death = 'shot';
  spin = 0;
  vspin = 0;
  runPhase = 0;
  shieldHp = 26;
  prefDist: number;
  bursts = 0;
  jitter = 0;
  charred = false;
  gesture = 0;
  patrolX = 0;
  alertDelay = 0;
  hitHead = 0;
  stumbleDir = 0;
  enterKind: 'none' | 'jump' | 'run' = 'none';
  // where an on-screen spawn visibly comes from (door, vehicle, bail-out); '' = placed/off-screen
  origin: '' | 'door' | 'vehicle' | 'bail' | 'bridge' = '';
  // aggression scaling for later sections
  aggro = 1;
  noticeRange = 170;

  constructor(x: number, y: number, role: Role = 'rifle', idle: Idle = 'stand', facing = -1) {
    super();
    this.x = x; this.y = y;
    this.role = role;
    this.idle = idle;
    this.facing = facing;
    this.team = 'enemy';
    this.hittable = true;
    this.meleeable = true;
    this.counts = true;
    this.z = 30;
    this.hp = role === 'shield' ? 4 : role === 'rusher' ? 2 : role === 'bazooka' ? 3 : 3;
    this.score = role === 'shield' ? 300 : role === 'bazooka' ? 200 : 100;
    this.prefDist = role === 'grenadier' ? 120 + Math.random() * 50 : role === 'bazooka' ? 150 + Math.random() * 40 : 80 + Math.random() * 70;
    this.cd = 40 + Math.random() * 60;
    this.patrolX = x;
    if (idle === 'none') this.state = 'combat';
  }

  box(): Rect | null {
    if (this.state === 'dying') return null;
    const low = this.duck || this.idle === 'sunbathe' && this.state === 'idle';
    const h = low ? 16 : this.kneel ? 20 : this.idle === 'sleep' && this.state === 'idle' || this.idle === 'eat' && this.state === 'idle' ? 18 : this.h;
    return { x: this.x - this.w / 2, y: this.y - h, w: this.w, h };
  }

  // Enter the scene by jumping in (from a building / truck) or running from off-screen.
  enter(kind: 'jump' | 'run', vx: number, vy = -3) {
    this.state = 'enter';
    this.enterKind = kind;
    this.vx = vx;
    this.vy = kind === 'jump' ? vy : 0;
    this.st = 0;
    this.facing = Math.sign(vx) || this.facing;
    return this;
  }

  alert(g: Game, delay = 0) {
    if (this.state !== 'idle') return;
    this.state = 'alert';
    this.st = -delay;
    if (this.idle === 'sleep' || this.idle === 'sunbathe') this.st -= 14;
    // wake the neighbours shortly after
    g.later(10, () => {
      for (const e of g.ents) if (e instanceof Soldier && e !== this && e.state === 'idle' && Math.abs(e.x - this.x) < 110) e.alert(g, 6 + ((Math.random() * 12) | 0));
    });
  }

  onHit(g: Game, h: Hit): Mat | null {
    if (this.state === 'dying') {
      // explosions juggle bodies for extra comedy
      if (h.kind === 'explosion' && this.age % 2 === 0 && this.onGround) {
        this.vy = -3;
        this.vx = h.dx * 2;
        this.onGround = false;
        this.vspin = 0.3 * Math.sign(h.dx || 1);
      }
      return null;
    }
    if (h.from !== 'player') return null;
    // shield blocks frontal hits
    if (this.role === 'shield' && this.shieldHp > 0 && h.kind !== 'explosion' && h.kind !== 'knife' && h.dx * this.facing < 0 && Math.abs(h.dy) < 0.8) {
      this.shieldHp -= h.kind === 'rocket' ? 30 : h.dmg;
      this.vx += h.dx * 0.25;
      this.jitter = 3;
      if (this.shieldHp <= 0) {
        g.add(new Gib(SHIELD_GIB, this.x + this.facing * 6, this.y - 16, -this.facing * 2, -3, 0.25, 140));
        g.snd('clank', this.x, 0.9, 0.7);
        g.fx.sparks(this.x + this.facing * 6, this.y - 16, 12, -Math.PI / 2, 1.4, 3, C.metalSpark);
        this.state = 'panic';
        this.st = 0;
      }
      if (this.state === 'idle') this.alert(g);
      return 'metal';
    }
    if (h.kind === 'fire') {
      this.burnAcc += h.dmg;
      this.flash = 2;
      if (this.burnAcc > 1.1 && this.state !== 'burn') {
        this.state = 'burn';
        this.st = 0;
        this.onFire = 1;
        this.scream(g, 1.1);
      }
      return 'flesh';
    }
    this.hp -= h.dmg;
    this.flash = 3;
    this.jitter = 3;
    this.hitHead = 8;
    if (this.state === 'idle' || this.state === 'alert') {
      this.state = 'combat';
      this.facing = h.dx > 0 ? -1 : 1;
    }
    if (this.hp <= 0) {
      this.die(g, h);
      return 'flesh';
    }
    // non-lethal reaction
    const f = h.force;
    this.vx += h.dx * f * 0.6;
    if (h.kind === 'heavy' || h.kind === 'pellet' || h.kind === 'explosion' || h.kind === 'rocket') {
      if (this.state !== 'windup' || h.kind !== 'heavy') {
        this.state = 'flinch';
        this.st = 0;
      }
      if (this.helmet && Math.random() < 0.25 && this.role !== 'rusher') this.popHelmet(g, h.dx);
    }
    if (h.kind === 'explosion') {
      this.vy = -2;
      this.onGround = false;
    }
    return 'flesh';
  }

  popHelmet(g: Game, dx: number) {
    this.helmet = false;
    g.add(new Gib(HELMET_GIB, this.x, this.y - 28, dx * 1.5 + (Math.random() - 0.5), -3.5, 0.35, 150));
    g.snd('clank', this.x, 0.4, 1.3);
  }

  scream(g: Game, pitch = 1) {
    if (screamCd > g.t) return;
    screamCd = g.t + 8;
    const p = pitch * (0.9 + Math.random() * 0.25);
    if (audio.hasVoice('enemy_die')) audio.voice('enemy_die', { vol: 0.55, pitch: p });
    else g.snd('scream', this.x, 0.5, p);
  }

  die(g: Game, h: Hit) {
    this.state = 'dying';
    this.st = 0;
    this.hittable = false;
    this.meleeable = false;
    g.kills++;
    g.addScore(this.score, this.x, this.y - 36);
    this.scream(g);
    this.duck = false;
    this.kneel = false;
    const d = Math.sign(h.dx) || 1;
    this.facing = -d;
    switch (h.kind) {
      case 'explosion':
      case 'rocket':
        this.death = 'blast';
        this.vx = h.dx * h.force * 0.9 + d * 0.5;
        this.vy = -4.5 - Math.random() * 1.5;
        this.vspin = d * (0.18 + Math.random() * 0.12);
        this.charred = Math.random() < 0.6;
        this.onGround = false;
        if (this.helmet) this.popHelmet(g, h.dx);
        break;
      case 'pellet':
        this.death = 'fling';
        this.vx = d * 3.2;
        this.vy = -2.4;
        this.vspin = d * 0.12;
        this.onGround = false;
        g.hitstop(2);
        break;
      case 'knife':
        this.death = 'slash';
        this.vx = d * 0.5;
        break;
      case 'fire':
        this.death = 'burn';
        break;
      default:
        this.death = 'shot';
        this.vx = d * (h.kind === 'heavy' ? 1.4 : 0.9);
        this.vy = -1.2;
        this.onGround = false;
    }
  }

  // ------------------------------------------------------------------ AI
  update(g: Game) {
    this.st++;
    if (this.jitter > 0) this.jitter--;
    if (this.hitHead > 0) this.hitHead--;
    const p = g.player;
    const dx = p.x - this.x;
    const adx = Math.abs(dx);
    const onScr = g.onScreen(this.x, -6);
    let move = 0;
    this.kneel = false;
    this.duck = false;

    switch (this.state) {
      case 'enter':
        if (this.enterKind === 'run') {
          move = Math.sign(this.vx) * 1.6;
          if (onScr && this.st > 20) { this.state = 'combat'; this.st = 0; this.cd = 20 + Math.random() * 40; }
        } else if (this.onGround && this.st > 2) {
          this.state = 'combat';
          this.st = 0;
          this.cd = 30 + Math.random() * 30;
          g.fx.dust(this.x, this.y, 3);
        } else move = this.vx;
        break;
      case 'idle': {
        const front = Math.sign(dx) === this.facing;
        if ((adx < this.noticeRange && (front || adx < 80) && onScr) || (adx < 60)) this.alert(g, 4);
        if (this.idle === 'patrol') {
          move = this.facing * 0.4;
          if (Math.abs(this.x - this.patrolX) > 30) {
            this.facing = this.x > this.patrolX ? -1 : 1;
          }
        } else if (this.idle === 'stand' && this.st % 150 === 100) this.facing = -this.facing;
        if (this.idle === 'sleep' && this.st % 50 === 0) g.fx.text(this.x + 6, this.y - 26, 'Z', C.white);
        this.gesture = Math.sin(this.st * 0.15 + this.x);
        break;
      }
      case 'alert':
        if (this.st === 1) {
          g.snd('alert', this.x, 0.4);
          this.vy = -2.2;
          this.onGround = false;
          this.facing = dx > 0 ? 1 : -1;
        }
        if (this.st > 26) { this.state = 'combat'; this.st = 0; this.cd = 20 + Math.random() * 40; }
        break;
      case 'combat': {
        if (this.onGround) this.facing = dx > 0 ? 1 : -1;
        this.cd -= this.aggro;
        if (this.role === 'rusher') {
          if (this.onGround) {
            move = this.facing * 2.3;
            if (adx < 40 && Math.abs(p.y - this.y) < 30) { this.state = 'windup'; this.st = 0; }
          }
          break;
        }
        if (this.role === 'shield') {
          if (this.shieldHp <= 0) { this.state = 'panic'; this.st = 0; break; }
          if (adx > 34) move = this.facing * 0.45;
          if (adx < 48 && this.cd < 40 && Math.abs(p.y - this.y) < 24) { this.state = 'bash'; this.st = 0; break; }
          if (this.cd <= 0 && onScr) { this.state = 'windup'; this.st = 0; }
          break;
        }
        const want = this.prefDist;
        if (this.cover) {
          this.duck = true;
        } else if (adx < want - 30) move = -this.facing * 0.7;
        else if (adx > want + 30) move = this.facing * 0.8;
        if (this.role === 'bazooka') this.kneel = true;
        if (this.cd <= 0 && onScr && adx < 260) {
          this.state = 'windup';
          this.st = 0;
          this.kneel = this.role === 'bazooka' || (this.role === 'rifle' && Math.random() < 0.35);
          this.bursts = this.role === 'rifle' && Math.random() < 0.4 ? 2 : 1;
        }
        break;
      }
      case 'windup': {
        if (this.onGround && this.role !== 'rusher') this.facing = dx > 0 ? 1 : -1;
        const wt = this.windupTime();
        if (this.role === 'rifle' || this.role === 'bazooka') {
          this.kneel = this.kneel || this.role === 'bazooka';
          const ty = p.y - (p.crouch ? 10 : 18);
          const my = this.y - (this.kneel ? 14 : 20);
          const a = Math.atan2(ty - my, Math.abs(dx));
          this.aimA += (Math.max(-0.4, Math.min(0.35, a)) - this.aimA) * 0.2;
          if (this.role === 'bazooka' && this.st % 8 === 0) g.fx.smoke(this.x - this.facing * 8, this.y - 20, 1, 2);
        }
        if (this.st >= wt) this.attack(g);
        break;
      }
      case 'recover':
        if (this.role === 'bazooka') this.kneel = true;
        if (this.st > (this.role === 'rusher' ? 30 : 22)) {
          if (this.bursts > 1 && this.role === 'rifle') {
            this.bursts--;
            this.state = 'windup';
            this.st = this.windupTime() - 10;
          } else {
            this.state = 'combat';
            this.st = 0;
            this.cd = (this.role === 'grenadier' ? 110 : this.role === 'bazooka' ? 150 : 90) + Math.random() * 50;
          }
        }
        break;
      case 'bash':
        if (this.st < 14) move = -this.facing * 0.3;
        else if (this.st < 24) {
          move = this.facing * 3;
          const pb = p.box();
          if (pb && Math.abs(p.x - (this.x + this.facing * 8)) < 10 && p.y > this.y - 34 && p.y < this.y + 4) p.hurt(g, this.x);
          if (this.st === 14) g.snd('throw', this.x, 0.6, 0.6);
        } else if (this.st > 50) { this.state = 'combat'; this.st = 0; this.cd = 100; }
        break;
      case 'leap':
        if (this.onGround && this.st > 4) {
          this.state = 'stumble';
          this.st = 0;
          g.fx.dust(this.x, this.y, 4);
        } else {
          move = this.vx;
          const pb = p.box();
          if (pb && Math.abs(p.x - this.x) < 12 && p.y - 30 < this.y && p.y + 2 > this.y - 24) p.hurt(g, this.x);
        }
        break;
      case 'stumble':
        move = this.facing * Math.max(0, 1.2 - this.st * 0.06);
        if (this.st > 36) { this.state = 'combat'; this.st = 0; }
        break;
      case 'flinch':
        if (this.st > 10) { this.state = 'combat'; this.st = 0; this.cd = Math.max(this.cd, 20); }
        break;
      case 'panic':
        move = (dx > 0 ? -1 : 1) * 1.9;
        this.facing = Math.sign(move);
        if (this.st % 40 === 1) this.scream(g, 1.3);
        if (this.st > 70) {
          this.state = 'combat';
          this.st = 0;
          if (this.role === 'shield') { this.role = 'rifle'; this.cd = 30; }
        }
        break;
      case 'burn':
        move = this.facing * 1.6;
        if (this.wall || this.st % 30 === 15) this.facing = -this.facing;
        if (this.st % 2 === 0) g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 10, y: this.y - 6 - Math.random() * 22, vy: -0.8, life: 12, size: 2 + Math.random() * 2, c: C.fire2 });
        if (this.st % 4 === 0) g.fx.light(this.x, this.y - 14, 30, [120, 60, 10], 5);
        if (this.st > 64) {
          g.kills++;
          g.addScore(this.score, this.x, this.y - 36);
          this.state = 'dying';
          this.death = 'burn';
          this.hittable = false;
          this.meleeable = false;
          this.st = 0;
        }
        break;
      case 'dying':
        return this.updateDying(g);
    }

    // panic when a live player grenade lands nearby
    if (this.state === 'combat' || this.state === 'idle') {
      for (const e of g.ents) {
        if (e instanceof Grenade && e.owner === 'player' && e.bounces > 0 && Math.abs(e.x - this.x) < 36) {
          this.state = 'panic';
          this.st = 0;
          this.scream(g, 1.4);
          break;
        }
      }
    }

    // never back off past the screen edge (enemies must stay reachable)
    if (move !== 0 && this.state !== 'enter' && this.state !== 'panic' && this.state !== 'burn') {
      const lo = g.cam.x + 14, hi = g.cam.x + 370;
      if ((move > 0 && this.x > hi) || (move < 0 && this.x < lo)) move = 0;
    }
    if (g.cam.lockL >= 0 && this.state !== 'enter' && this.state !== 'dying' && this.x > g.cam.lockL && this.x < g.cam.lockR) {
      this.x = Math.max(g.cam.lockL + 8, Math.min(g.cam.lockR - 8, this.x));
    }
    // integrate
    const accel = this.onGround ? 0.3 : 0.08;
    if (this.state !== 'enter' || this.enterKind === 'run') {
      if (this.vx < move) this.vx = Math.min(move, this.vx + accel);
      else if (this.vx > move) this.vx = Math.max(move, this.vx - accel);
    }
    this.vy = Math.min(5, this.vy + 0.28);
    g.moveBody(this);
    if (this.onGround && Math.abs(this.vx) > 0.15) this.runPhase = (this.runPhase + Math.abs(this.vx) / 20) % 1;
    if (this.y > g.cam.y + 400) this.dead = true;
    // despawn far behind the camera
    if (this.x < g.cam.x - 200) this.dead = true;
  }

  windupTime() {
    switch (this.role) {
      case 'rifle': return 30;
      case 'grenadier': return 26;
      case 'bazooka': return 48;
      case 'shield': return 24;
      case 'rusher': return 9;
    }
  }

  attack(g: Game) {
    const p = g.player;
    const f = this.facing;
    this.state = 'recover';
    this.st = 0;
    switch (this.role) {
      case 'rifle': {
        const my = this.y - (this.kneel ? 14 : 20);
        const mx = this.x + f * 16;
        const a = this.aimA;
        g.add(new EBullet(mx, my, Math.cos(a) * f * 2.4, Math.sin(a) * 2.4));
        g.snd('pistol', this.x, 0.45, 0.75);
        g.fx.light(mx, my, 16, [120, 60, 60], 3);
        g.fx.star(mx, my, 3, 2, C.fire1);
        break;
      }
      case 'shield': {
        const my = this.y - 20;
        const mx = this.x + f * 10;
        const a = Math.atan2(p.y - 16 - my, Math.abs(p.x - this.x));
        const aa = Math.max(-0.35, Math.min(0.35, a));
        g.add(new EBullet(mx, my, Math.cos(aa) * f * 2.4, Math.sin(aa) * 2.4));
        g.snd('pistol', this.x, 0.4, 0.9);
        break;
      }
      case 'grenadier': {
        const tx = p.x + (Math.random() - 0.5) * 20 + p.vx * 20;
        const dx = tx - this.x;
        const T = Math.max(34, Math.min(64, Math.abs(dx) / 2));
        const sy = this.y - 26;
        const dy = p.y - 2 - sy;
        const vy = (dy - 0.08 * T * T) / T;
        g.add(new Grenade(this.x + f * 2, sy, dx / T, vy, 'enemy'));
        g.snd('throw', this.x, 0.5);
        break;
      }
      case 'bazooka': {
        const my = this.y - 16;
        g.add(new ERocket(this.x + f * 14, my, f > 0 ? this.aimA * 0.6 : Math.PI - this.aimA * 0.6, 2.8));
        g.snd('rocket', this.x, 0.6, 0.8);
        g.fx.smoke(this.x - f * 12, my, 5, 4, C.smoke0, 0.2);
        this.vx -= f * 1;
        break;
      }
      case 'rusher': {
        this.state = 'leap';
        this.vx = f * 3.2;
        this.vy = -3.2;
        this.onGround = false;
        g.snd('slash', this.x, 0.6, 0.8);
        break;
      }
    }
  }

  updateDying(g: Game) {
    const onG = this.onGround;
    if (this.death === 'burn' || this.death === 'slash') {
      this.vx *= 0.8;
    } else if (!this.onGround) {
      this.spin += this.vspin;
    }
    this.vy = Math.min(5, this.vy + 0.25);
    g.moveBody(this);
    if (this.onGround) {
      if (!onG && this.st > 2) {
        g.fx.dust(this.x, this.y, 3);
        if (this.death === 'blast' || this.death === 'fling') {
          if (Math.abs(this.vy) < 0.1 && this.st < 70 && this.vspin !== 0) {
            // bounce once
            this.vy = -1.8;
            this.onGround = false;
            this.vspin *= 0.5;
            g.snd('land', this.x, 0.5);
          }
        }
      }
      this.vx *= 0.82;
      if (this.death === 'blast' || this.death === 'fling' || this.death === 'shot') {
        // settle flat
        const tgt = this.death === 'shot' ? -Math.PI / 2 : Math.round(this.spin / Math.PI) * Math.PI - Math.PI / 2;
        this.spin += (tgt - this.spin) * 0.25;
      }
    }
    if (this.death === 'shot' && this.st < 26) {
      // stagger, then topple backwards
      if (this.st > 10) this.spin += (-Math.PI / 2 - this.spin) * 0.18;
    }
    if (this.death === 'slash' && this.st > 8) {
      // freeze on the cut, then fold forward onto the face
      this.spin += (Math.PI / 2 - this.spin) * 0.16;
    }
    if (this.charred && this.st % 9 === 0 && this.st < 90) g.fx.add({ t: PT.Smoke, x: this.x, y: this.y - 6, vy: -0.4, life: 30, size: 1, size2: 3, c: C.smoke1 });
    if (this.st > 110) this.dead = true;
  }

  // ------------------------------------------------------------------ draw
  draw(g: Game, s: Surface) {
    if (this.state === 'dying' && this.st > 80 && (this.st & 2)) return;
    rig.begin();
    this.pose(g);
    const jx = this.jitter > 0 ? ((this.jitter & 1) ? 1 : -1) : 0;
    let o: BlitOpts | undefined = this.flash > 0 ? { mode: Mode.Flash, color: 0xffffffff } : undefined;
    if (!o && (this.charred || this.state === 'burn')) o = { mode: Mode.Tint, color: C.black, amount: this.state === 'burn' ? 0.35 + 0.2 * Math.sin(this.st) : 0.72 };
    const flip = this.facing < 0;
    if (this.state === 'dying' && this.death === 'burn') {
      // collapse into an ash pile
      const k = Math.min(1, this.st / 40);
      o = { mode: Mode.Tint, color: C.black, amount: 0.85 };
      if (k < 1) rig.present(s, this.x, this.y + Math.round(k * 14), flip, o);
      s.odisc(this.x, this.y - 2, 3 + k * 3, C.smoke2);
      s.rect(this.x - 6, this.y - 2, 12, 2, C.smoke2);
      if (this.st < 60 && this.st % 3 === 0) g.fx.embers(this.x, this.y - 4, 1, 5);
      return;
    }

    if (this.state === 'dying' || Math.abs(this.spin) > 0.01) {
      // when lying down, lower the pivot so the body rests on the ground
      const lie = this.onGround ? Math.abs(Math.sin(this.spin)) * 9 : 0;
      rig.presentRot(s, this.x + jx, this.y + Math.round(lie), -12, this.spin, flip, o);
    } else rig.present(s, this.x + jx, this.y, flip, o);

    // muzzle glint: the last 16 frames before a rifle / pistol shot (drawn unclipped, world space)
    if (this.state === 'windup' && (this.role === 'rifle' || this.role === 'shield')) {
      const left = this.windupTime() - this.st;
      if (left < 16 && (left < 7 || ((g.t >> 2) & 1))) {
        const mx = Math.round(this.x + this.facing * (this.role === 'rifle' ? 17 : 11));
        const my = Math.round(this.y - (this.kneel ? 14 : 20) + (this.role === 'rifle' ? Math.sin(this.aimA) * 14 : 0));
        const r = left < 7 ? 4 : 3;
        s.rect(mx - r - 1, my - 1, r * 2 + 3, 3, C.outline);
        s.rect(mx - 1, my - r - 1, 3, r * 2 + 3, C.outline);
        s.hline(mx - r, mx + r, my, C.white);
        s.vline(mx, my - r, my + r, C.white);
        s.pset(mx, my, C.yellow);
      }
    }
    // alert "!" pop
    if (this.state === 'alert' && this.st > 0 && this.st < 22) {
      const pop = this.st < 4 ? -this.st : -4;
      drawText(s, '!', this.x - 2, this.y - 42 + pop, C.yellow);
    }
    if (this.state === 'idle' && this.idle === 'chat' && (this.st % 120) < 50 && this.facing > 0) {
      drawText(s, '...', this.x + 4, this.y - 40, C.white);
    }
  }

  private pose(g: Game) {
    const R = rig;
    const st = this.state;
    const idleSit = st === 'idle' && (this.idle === 'sleep' || this.idle === 'eat');
    const sunbathe = st === 'idle' && this.idle === 'sunbathe';
    let hip = v(0, -12), neck = v(0, -21);
    let footB = v(-3, 0), footF = v(3, 0);
    let headBob = 0;
    const running = this.onGround && Math.abs(this.vx) > 0.2 && st !== 'dying';
    let head = this.helmet ? HEAD_TIN : HEAD_TIN_BALD;
    if (this.role === 'rusher') head = HEAD_RUSHER;
    else if (st === 'alert' || st === 'panic' || st === 'burn' || this.flash > 0) head = this.helmet ? HEAD_TIN_SURPRISE : HEAD_TIN_BALD;
    else if (this.hitHead > 0 || st === 'flinch') head = this.helmet ? HEAD_TIN_HURT : HEAD_TIN_BALD;
    if (st === 'dying') head = this.helmet ? HEAD_TIN_DEAD : HEAD_TIN_BALD;
    if (this.role === 'rusher' && st === 'dying') head = HEAD_RUSHER;

    if (idleSit) {
      hip = v(-2, -4);
      footB = v(5, 0);
      footF = v(7, 0);
      neck = v(-3 + (this.idle === 'sleep' ? -1 : 0), -13 + (this.idle === 'sleep' && Math.sin(this.st * 0.05) > 0 ? 1 : 0));
    } else if (sunbathe) {
      // lying on the back: draw a relaxed standing pose and rotate later
      hip = v(0, -12);
      footB = v(-2, 0);
      footF = v(2, -1);
    } else if (this.kneel) {
      hip = v(-1, -7);
      footB = v(-7, 0);
      footF = v(4, 0);
      neck = v(1, -16);
    } else if (this.duck) {
      hip = v(-1, -6);
      footB = v(-5, 0);
      footF = v(4, 0);
      neck = v(2, -13);
    } else if (!this.onGround && st !== 'dying') {
      hip = v(0, -13);
      footB = v(-4, -4);
      footF = v(4, -5);
      neck = v(0, -22);
      if (st === 'leap') { footB = v(-7, -2); footF = v(6, -6); neck = v(3, -21); }
    } else if (running) {
      const p = Math.floor(this.runPhase * 8) / 8;
      const stride = st === 'panic' || st === 'burn' || this.role === 'rusher' ? 7 : 5;
      const leg = (q: number): V => {
        q = ((q % 1) + 1) % 1;
        if (q < 0.5) return v(stride - 4 * stride * q, 0);
        const k = (q - 0.5) / 0.5;
        return v(-stride + 2 * stride * k, -Math.sin(k * Math.PI) * 4);
      };
      footF = leg(p);
      footB = leg(p + 0.5);
      const bob = Math.cos(p * Math.PI * 4) > 0.3 ? 1 : 0;
      hip = v(0, -12 + bob);
      neck = v(this.role === 'rusher' || st === 'panic' ? 3 : 1, -21 + bob);
      headBob = bob;
    } else if (st === 'dying' && this.death === 'shot' && this.st < 12) {
      // stagger: head snaps back, knees buckle
      hip = v(-1, -11 + (this.st > 6 ? 1 : 0));
      neck = v(-4, -20);
      footB = v(-4, 0);
      footF = v(3, 0);
    } else if (st === 'dying') {
      neck = v(-1, -21);
      footB = v(-4, -1);
      footF = v(4, -2);
    } else if (st === 'flinch') {
      neck = v(-3, -20);
      hip = v(-1, -12);
    } else if (st === 'alert') {
      neck = v(-1, -22);
    } else if (st === 'bash' && this.st >= 14 && this.st < 24) {
      neck = v(4, -20);
      footB = v(-6, 0);
      footF = v(5, 0);
    } else if (st === 'windup' && this.role === 'grenadier') {
      neck = v(-2, -21);
    }

    const shF = v(neck.x + 1, neck.y + 2), shB = v(neck.x - 1, neck.y + 2);
    // default: rifle held at port arms
    const f = this;
    let aim = -0.9;
    let handMode: 'rifle' | 'free' | 'grenade' | 'machete' | 'tube' | 'shield' = 'rifle';
    if (f.role === 'grenadier') handMode = 'grenade';
    if (f.role === 'rusher') handMode = 'machete';
    if (f.role === 'bazooka') handMode = 'tube';
    if (f.role === 'shield') handMode = f.shieldHp > 0 ? 'shield' : 'free';
    if (st === 'windup' || st === 'recover') aim = this.aimA;
    if (st === 'panic' || st === 'burn' || st === 'dying' || st === 'alert' || idleSit || sunbathe) handMode = handMode === 'shield' && st !== 'dying' && st !== 'panic' ? 'shield' : 'free';
    if (st === 'combat' && f.role === 'rifle') aim = -0.25;

    const dir = v(Math.cos(aim), Math.sin(aim));
    const perp = v(-dir.y, dir.x);
    const recoil = st === 'recover' && this.st < 6 ? 2 : 0;
    const grip = v(shF.x + dir.x * 3 + perp.x * 1.5 - dir.x * recoil, shF.y + dir.y * 3 + perp.y * 1.5 - dir.y * recoil);
    let handF = grip, handB = v(grip.x + dir.x * 6, grip.y + dir.y * 6);

    const t = this.st;
    if (handMode === 'free') {
      if (st === 'panic' || st === 'burn' || (st === 'alert' && t > 0)) {
        // arms flailing above the head
        const w = Math.sin(t * 0.6) * 3;
        handF = v(shF.x + 3 + w, shF.y - 9);
        handB = v(shB.x - 3 - w, shB.y - 8);
      } else if (st === 'dying') {
        handF = v(shF.x + 5, shF.y - 5);
        handB = v(shB.x - 6, shB.y - 3);
      } else if (idleSit && this.idle === 'eat') {
        handF = v(shF.x + 4, shF.y - 3 + (Math.sin(t * 0.1) > 0.6 ? -2 : 0));
        handB = v(shB.x + 2, shB.y + 5);
      } else {
        handF = v(shF.x + 1, shF.y + 7);
        handB = v(shB.x - 1, shB.y + 7);
      }
    } else if (handMode === 'grenade') {
      if (st === 'windup') {
        const k = t / 26;
        const a = 2.8 - k * 0.6;
        handF = v(shF.x + Math.cos(a) * 9, shF.y + Math.sin(a) * 9 - 2);
      } else if (st === 'recover' && t < 10) {
        const a = -0.4 + t * 0.12;
        handF = v(shF.x + Math.cos(a) * 9, shF.y + Math.sin(a) * 9);
      } else handF = v(shF.x + 3, shF.y + 6);
      handB = v(shB.x + 2, shB.y + 7);
    } else if (handMode === 'machete') {
      if (st === 'leap' || (st === 'recover' && t < 8)) handF = v(shF.x + 8, shF.y + 2);
      else handF = v(shF.x + 3, shF.y - 8);
      handB = v(shB.x - 3, shB.y + 6 + (running ? Math.round(Math.sin(this.runPhase * 6.28) * 2) : 0));
    } else if (handMode === 'tube') {
      handF = v(shF.x + 3, shF.y + 3);
      handB = v(shF.x + 7, shF.y + 1);
    } else if (handMode === 'shield') {
      const push = st === 'bash' && t >= 14 && t < 24 ? 3 : st === 'bash' && t < 14 ? -2 : 0;
      handF = v(shF.x + 5 + push, shF.y + 3);
      handB = v(shF.x + 5 + push, shF.y + 8);
      if (st === 'windup' || (st === 'recover' && t < 10)) handB = v(shF.x + 9, shF.y - 1);
    }
    if (st === 'idle' && this.idle === 'chat') {
      handF = v(shF.x + 4 + Math.round(this.gesture * 2), shF.y - 1 + Math.round(this.gesture * 3));
      handMode = 'free';
    }

    // back arm
    const eB = ik(shB, handB, 5, 5, 1);
    R.limb(shB, eB, 3, C.uniSh);
    R.limb(eB, handB, 2, C.eskinSh);
    // legs
    const drawLeg = (foot: V, back: boolean) => {
      const ankle = v(foot.x, foot.y - 2);
      const knee = ik(hip, ankle, 6, 6, idleSit ? 1 : -1);
      R.limb(hip, knee, 3, back ? C.epantsSh : C.epants);
      R.limb(knee, ankle, 3, back ? C.epantsSh : C.epants);
      R.orect(ankle.x - 2, ankle.y, 5, 2, C.eboot);
    };
    if (this.kneel) {
      // back knee on the ground
      const kneeB = v(-4, -1);
      R.limb(hip, kneeB, 3, C.epantsSh);
      R.limb(kneeB, v(-9, -1), 3, C.epantsSh);
      R.orect(-11, -2, 3, 2, C.eboot);
      drawLeg(footF, false);
    } else {
      drawLeg(footB, true);
      drawLeg(footF, false);
    }
    // torso
    const uni = this.role === 'rusher' ? C.rusher : C.uni;
    R.limb(hip, neck, 6, uni);
    R.bare(v(hip.x + 1, hip.y - 2), v(neck.x + 1, neck.y + 2), 2, this.role === 'rusher' ? C.rusherSh : C.uniHi);
    R.bare(v(hip.x - 2, hip.y - 1), v(hip.x + 3, hip.y - 1), 2, C.belt);
    if (this.role === 'grenadier') R.orect(hip.x - 5, hip.y - 3, 3, 4, C.belt);
    if (this.role === 'bazooka') R.orect(neck.x - 6, neck.y + 2, 3, 6, C.tinSh);
    // head
    const hy = neck.y - 10 + headBob;
    R.sprite(head, neck.x - 5, hy);
    if (sunbathe) {
      R.rect(neck.x + 1, hy + 5, 4, 1, C.black); // sunglasses
    }
    // weapon
    if (handMode === 'rifle') {
      const at = (d: number, pp = 0) => v(grip.x + dir.x * d + perp.x * pp, grip.y + dir.y * d + perp.y * pp);
      R.limb(at(-4, 1), at(1, 1), 2, C.wood);
      R.limb(at(0), at(13), 2, C.gun);
      R.px(at(9).x, at(9).y, C.gunHi);

    } else if (handMode === 'tube') {
      const d2 = v(Math.cos(this.aimA * 0.6), Math.sin(this.aimA * 0.6));
      const base = v(shF.x - 8 * d2.x, shF.y - 2 - 8 * d2.y);
      R.limb(base, v(base.x + d2.x * 20, base.y + d2.y * 20), 4, C.tin);
      R.bare(v(base.x + 2, base.y - 1), v(base.x + d2.x * 18, base.y + d2.y * 18 - 1), 1, C.tinHi);
      R.orect(Math.round(base.x + d2.x * 19), Math.round(base.y + d2.y * 19) - 2, 2, 4, C.tinSh);
      if (st === 'windup' && (this.st & 4)) R.px(Math.round(base.x + d2.x * 21), Math.round(base.y + d2.y * 21), C.ebul);
    } else if (handMode === 'machete') {
      const a = st === 'leap' ? 0.3 : -1.2;
      R.limb(handF, v(handF.x + Math.cos(a) * 8, handF.y + Math.sin(a) * 8), 2, C.steelHi);
      R.px(handF.x + Math.cos(a) * 7, handF.y + Math.sin(a) * 7, C.white);
    } else if (handMode === 'grenade' && (st === 'windup' || st === 'combat')) {
      R.odisc(handF.x, handF.y - 1, 2, C.tinSh);
    }
    // front arm
    const eF = ik(shF, handF, 5, 5, handMode === 'free' && (st === 'panic' || st === 'burn') ? -1 : 1);
    R.limb(shF, eF, 3, this.role === 'rusher' ? C.eskin : C.uni);
    R.limb(eF, handF, 2, C.eskin);
    if (idleSit && this.idle === 'eat') {
      // fish on a stick
      R.bare(handF, v(handF.x + 5, handF.y - 5), 1, C.woodHi);
      R.odisc(handF.x + 5, handF.y - 6, 1, C.tinHi);
      R.px(handF.x + 7, handF.y - 7, C.tinHi);
    }
    // riot shield in front of everything
    if (handMode === 'shield') {
      const push = st === 'bash' && t >= 14 && t < 24 ? 3 : st === 'bash' && t < 14 ? -2 : 0;
      const sx = 6 + push, sy = -25;
      R.orect(sx, sy, 5, 24, C.steel);
      R.rect(sx + 1, sy + 1, 1, 22, C.steelHi);
      R.rect(sx + 1, sy + 5, 3, 1, C.black); // view slit
      const dmg = this.shieldHp;
      if (dmg < 18) { R.px(sx + 3, sy + 12, C.steelSh); R.px(sx + 2, sy + 13, C.steelSh); }
      if (dmg < 10) { R.px(sx + 2, sy + 18, C.black); R.px(sx + 3, sy + 8, C.black); R.px(sx + 1, sy + 16, C.steelSh); }
      R.px(sx + 4, sy + 2, C.tinHi);
      R.px(sx + 4, sy + 21, C.tinHi);
    }
    if (sunbathe) {
      // re-render rotated: handled by caller through spin
      this.spin = -Math.PI / 2;
    } else if (st === 'alert' && this.idle === 'sunbathe' && this.st < 8) {
      this.spin = -Math.PI / 2 * (1 - this.st / 8);
    } else if (st !== 'dying' && Math.abs(this.spin) > 0 && this.idle === 'sunbathe') {
      this.spin = 0;
    }
    void g;
  }
}
