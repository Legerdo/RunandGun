import { Surface, Mode, type BlitOpts } from '../engine/surface';
import { audio } from '../engine/audio';
import { C } from './palette';
import { Ent, type Hit, type Mat, type Rect, type Solid } from './types';
import { Rig, v, HEAD_TIN, bake } from './puppet';
import { EBullet, ERocket, Grenade, Mortar } from './weapons';
import { Soldier } from './enemies';
import { Gib } from './gib';
import { PT } from './fx';
import { aimLine, lane, alertBadge, groundZone } from './danger';
import { W, type Game } from './world';
import type { Building } from './decor';

// Big targets flicker with a light tint when hit instead of going fully white.
export function hitTint(flash: number, t: number): BlitOpts | undefined {
  return flash > 0 && (t & 2) === 0 ? { mode: Mode.Tint, color: 0xffffffff, amount: 0.45 } : undefined;
}

// =================================================================== IRONPOT tank (mid-boss)
const tankRig = new Rig(170, 96, 85, 84);
const turretRig = new Rig(70, 44, 35, 34);

export class Tank extends Ent {
  maxHp = 150;
  state: 'wait' | 'enter' | 'idle' | 'cannon' | 'flat' | 'mg' | 'hatch' | 'rev' | 'charge' | 'back' | 'dying' = 'wait';
  st = 0;
  facing = -1;
  barrel = -0.35; // radians (negative = raised), relative to facing
  barrelT = -0.35;
  tread = 0;
  hatchUp = 0;
  armor = true;
  rock = 0;
  nextAtk = 0;
  building: Building | null;
  arenaL: number;
  arenaR: number;
  onDead: (() => void) | null = null;
  reinforced = false;
  cmdHit = 0;
  behindT = 0;
  rumble = false;
  hull: Solid;
  constructor(g: Game, x: number, y: number, arenaL: number, arenaR: number, building: Building | null) {
    super();
    this.x = x; this.y = y;
    this.hp = this.maxHp;
    this.team = 'enemy';
    this.hittable = true;
    this.counts = true;
    this.z = 34;
    this.score = 10000;
    this.building = building;
    this.arenaL = arenaL;
    this.arenaR = arenaR;
    this.hull = g.solid(x - 40, y - 36, 80, 4, true, 'tank');
    this.hull.alive = false;
  }
  box(): Rect | null {
    if (this.state === 'dying' || this.state === 'wait') return null;
    return { x: this.x - 44, y: this.y - 50, w: 88, h: 50 };
  }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player' || this.state === 'dying' || this.state === 'wait') return null;
    // commander exposed in the hatch takes big damage
    const hx = this.x - this.facing * 2;
    if (this.hatchUp > 0.6 && Math.abs(h.x - hx) < 7 && h.y < this.y - 50 && h.y > this.y - 66) {
      this.hp -= h.dmg * 3;
      this.cmdHit = 10;
      this.flash = 3;
      if (this.hp <= 0) this.die(g);
      return 'flesh';
    }
    const mult = h.kind === 'explosion' || h.kind === 'rocket' ? 1.2 : this.armor ? 0.7 : 1;
    this.hp -= h.dmg * mult;
    this.flash = 4;
    if (this.armor && this.hp < this.maxHp * 0.66) {
      this.armor = false;
      g.add(new Gib(PLATE, this.x + this.facing * 38, this.y - 24, this.facing * 2.5, -3, 0.3, 160));
      g.fx.sparks(this.x + this.facing * 38, this.y - 24, 14, -Math.PI / 2, 1.5, 3.5, C.metalSpark);
      g.snd('clank', this.x, 1, 0.6);
      g.explode(this.x + this.facing * 36, this.y - 26, 16, 0, 'player', { scale: 1 });
      g.shake(4);
    }
    if (!this.reinforced && this.hp < this.maxHp * 0.5) {
      this.reinforced = true;
      for (let i = 0; i < 2; i++) {
        const s = new Soldier(g.cam.x + 400 + i * 20, this.y, i ? 'grenadier' : 'rifle', 'none', -1);
        s.enter('run', -1.5);
        s.tag = 'tank';
        g.add(s);
      }
    }
    if (this.hp <= 0) this.die(g);
    return 'metal';
  }
  die(g: Game) {
    this.state = 'dying';
    this.st = 0;
    this.hittable = false;
    this.counts = false;
    g.kills++;
    g.addScore(this.score, this.x, this.y - 70);
    g.hitstop(10);
    g.flash(5, C.white);
    g.shake(8);
    audio.play('expl_l', { vol: 1 });
  }
  update(g: Game) {
    this.st++;
    const p = g.player;
    const dx = p.x - this.x;
    this.rock *= 0.85;
    if (this.cmdHit > 0) this.cmdHit--;
    let move = 0;
    // exhaust smoke
    if (this.state !== 'wait' && this.age % (this.hp < this.maxHp * 0.4 ? 3 : 8) === 0) {
      g.fx.smoke(this.x - this.facing * 30, this.y - 50, 1, 4, this.hp < this.maxHp * 0.4 ? C.smoke2 : C.smoke1, 0.8);
    }
    if (this.hp < this.maxHp * 0.4 && this.state !== 'dying' && this.age % 3 === 0) g.fx.add({ t: PT.Fire, x: this.x - this.facing * 20 + (Math.random() - 0.5) * 10, y: this.y - 32, vy: -1, life: 12, size: 3, c: C.fire2 });

    switch (this.state) {
      case 'wait':
        if (this.rumble && this.building) {
          // the armory wall shakes and sheds dust before the tank bursts out
          const b = this.building;
          if (this.age % 5 === 0) g.fx.debris(b.x + 10 + Math.random() * (b.w - 20), GROUND_Y - 30 - Math.random() * 60, 1, C.plasterSh, 0.5, 0.5, 2);
          if (this.age % 7 === 0) g.fx.dust(b.x + b.w / 2 - 20 + Math.random() * 40, GROUND_Y, 1, -1, C.plasterSh);
          if (this.age % 20 === 0) { g.shake(1.2); g.snd('crumble', b.x, 0.25, 1.4); }
        }
        return;
      case 'enter':
        move = -0.9;
        if (this.st === 1 && this.building) {
          this.building.smashed = 1;
          const bx = this.building.x + this.building.w / 2;
          g.fx.chunks(bx, this.y - 30, 24, C.plaster, C.plasterSh, 9, 3, 4, 6);
          g.fx.chunks(bx, this.y - 30, 10, C.roof, C.roofSh, 7, 2, 4, 6);
          g.fx.dust(bx - 20, this.y - 10, 24, -1, C.plasterSh);
          g.fx.smoke(bx - 20, this.y - 30, 10, 12, C.smoke0, 0.3);
          g.snd('crumble', bx, 1);
          g.snd('expl_m', bx, 0.7);
          g.shake(9);
          g.hitstop(6);
          this.building.blast(g, bx, this.y - 40, 60);
        }
        if (this.st % 10 === 0) g.fx.dust(this.x + 30, this.y, 3, 1, C.plasterSh);
        if (this.x < this.arenaR - 110) { this.state = 'idle'; this.st = 0; audio.voice('tank', { priority: true }); }
        break;
      case 'idle': {
        const want = Math.max(this.arenaL + 150, Math.min(this.arenaR - 70, p.x + 130));
        if (Math.abs(this.x - want) > 8) move = Math.sign(want - this.x) * 0.5;
        this.barrelT = -0.3;
        if (this.st > 50) this.pickAttack();
        break;
      }
      case 'cannon': {
        // telegraph: barrel raises & glows, the tank settles back
        this.barrelT = -0.55;
        if (this.st === 1) g.snd('steam', this.x, 0.6);
        if (this.st % 5 === 0 && this.st < 40) g.fx.steam(this.x + this.facing * 8, this.y - 50, 1, 0, -0.6);
        if (this.st === 44) {
          const m = this.muzzle();
          g.fx.smoke(m.x, m.y, 6, 5, C.smoke0, 0.3);
          g.fx.light(m.x, m.y, 50, [220, 150, 60], 6);
          g.snd('thoomp', this.x, 1);
          g.snd('expl_s', this.x, 0.6);
          g.shake(4);
          this.rock = -3;
          // shells land around the player (dodge by moving)
          const t0 = p.x + p.vx * 30;
          for (let i = 0; i < 3; i++) {
            const tx = Math.max(this.arenaL + 20, Math.min(this.arenaR - 20, t0 + (i - 1) * 46));
            g.add(new Mortar(tx, Math.min(GROUND_Y, g.groundAt(tx, p.y - 40)), 54 + i * 10, 26));
          }
        }
        if (this.st > 70) this.toIdle();
        break;
      }
      case 'flat': {
        // barrel levels out at chest height: crouch or slide under the shell
        this.barrelT = 0.12;
        if (this.st === 1) g.snd('charge', this.x, 0.5, 1.4);
        if (this.st === 36) {
          const m = this.muzzle();
          const b = new EBullet(m.x, this.y - 24, this.facing * 4.2, 0, 4);
          g.add(b);
          g.fx.smoke(m.x, m.y, 5, 4, C.smoke0, 0.3);
          g.fx.light(m.x, m.y, 40, [220, 150, 60], 5);
          g.snd('thoomp', this.x, 1, 1.2);
          g.shake(3);
          this.rock = -3;
        }
        if (this.st > 60) this.toIdle();
        break;
      }
      case 'mg': {
        // low hull MG: jump over the stream
        if (this.st > MG_WARN && this.st < MG_WARN + 44 && this.st % 5 === 0) {
          const mx = this.x + this.facing * 46, my = this.y - 9;
          g.add(new EBullet(mx, my, this.facing * 3, 0, 2));
          g.snd('gat', this.x, 0.4, 0.8);
          g.fx.light(mx, my, 14, [120, 60, 60], 2);
        }
        if (this.st > MG_WARN + 64) this.toIdle();
        break;
      }
      case 'hatch': {
        this.hatchUp = Math.min(1, this.hatchUp + 0.08);
        if (this.st === 30 || this.st === 60) {
          const sx = this.x - this.facing * 2, sy = this.y - 62;
          const tx = p.x + (Math.random() - 0.5) * 30;
          const T = 50;
          g.add(new Grenade(sx, sy, (tx - sx) / T, (p.y - sy - 0.08 * T * T) / T, 'enemy'));
          g.snd('throw', this.x, 0.5);
        }
        if (this.st > 90) { this.hatchUp = 0; this.toIdle(); }
        break;
      }
      case 'rev':
        // telegraph the charge: treads spin in place, heavy smoke
        this.tread += 1.2 * -this.facing;
        this.x += Math.sin(this.st * 1.3) * 0.6;
        if (this.st % 3 === 0) g.fx.dust(this.x - this.facing * 40, this.y, 2, -this.facing);
        if (this.st % 4 === 0) g.fx.smoke(this.x - this.facing * 30, this.y - 50, 1, 5, C.smoke2, 1);
        if (this.st === 1) g.snd('roar', this.x, 0.6, 1.6);
        if (this.st > 40) { this.state = 'charge'; this.st = 0; }
        break;
      case 'charge':
        move = this.facing * 2.4;
        g.shake(1.5);
        if (this.st % 3 === 0) g.fx.dust(this.x - this.facing * 40, this.y, 2, -this.facing);
        if ((this.facing < 0 && this.x < this.arenaL + 70) || (this.facing > 0 && this.x > this.arenaR - 70) || this.st > 120) {
          this.state = 'back';
          this.st = 0;
          g.shake(5);
          g.snd('slam', this.x, 0.6);
        }
        break;
      case 'back':
        move = -this.facing * 1.2;
        if (this.st > 50) this.toIdle();
        break;
      case 'dying': {
        if (this.st % 8 === 0 && this.st < 70) {
          g.explode(this.x + (Math.random() - 0.5) * 80, this.y - Math.random() * 50, 26, 0, 'player', { scale: 1.4 });
          g.fx.chunks(this.x, this.y - 30, 3, C.tin, C.tinHi, 8, 3, 4, 5);
        }
        if (this.st === 60) {
          // the turret pops off
          turretRig.begin();
          this.drawTurret(turretRig, g);
          const t = new Gib(turretRig.s, this.x, this.y - 60, -this.facing * 1.5, -7, 0.18, 260, { bounce: 0.25, smoke: true, flip: this.facing < 0, z: 60 });
          g.add(t);
          g.snd('clank', this.x, 1, 0.5);
        }
        if (this.st === 84) {
          g.explode(this.x, this.y - 24, 60, 0, 'player', { scale: 3 });
          g.flash(6, C.fire1);
          g.shake(12);
          g.hitstop(8);
          const s = new Soldier(this.x, this.y - 50, 'rifle', 'none', this.facing);
          s.counts = false;
          g.add(s);
          s.die(g, { dmg: 99, kind: 'explosion', x: this.x, y: this.y, dx: -this.facing, dy: -1, force: 3, from: 'player' });
          g.kills--; g.score -= s.score;
        }
        if (this.st > 84 && this.st % 4 === 0) {
          g.fx.add({ t: PT.Fire, x: this.x + (Math.random() - 0.5) * 70, y: this.y - 20 - Math.random() * 10, vy: -1, life: 16, size: 4, c: C.fire2 });
          if (this.st % 8 === 0) g.fx.smoke(this.x + (Math.random() - 0.5) * 60, this.y - 30, 1, 7, C.smoke2, 0.7);
        }
        if (this.st === 100 && this.onDead) this.onDead();
        break;
      }
    }
    if (this.state !== 'hatch' && this.hatchUp > 0) this.hatchUp = Math.max(0, this.hatchUp - 0.1);
    this.barrel += (this.barrelT - this.barrel) * 0.08;
    if (this.state !== 'dying') {
      this.x += move;
      if (move !== 0) this.tread += move;
      // turn around only after the player has stayed behind the tank for a moment (no flicker
      // when they hop over it), and only between attacks
      const behind = Math.sign(dx) !== this.facing && Math.abs(dx) > 24;
      this.behindT = behind ? this.behindT + 1 : 0;
      if (this.behindT > 36 && this.state === 'idle') {
        this.facing = -this.facing;
        this.behindT = 0;
        this.rock = 2;
        g.fx.dust(this.x - this.facing * 40, this.y, 5, -this.facing);
        g.snd('slam', this.x, 0.3, 1.6);
      }
      // hull top is a platform you can hop onto (dodges the charge)
      this.hull.alive = true;
      this.hull.x = this.x - 40;
      this.hull.y = this.y - 36 + Math.round(this.rock);
      // body collision: crush during charge / entry, otherwise ease the player out sideways
      const pb = p.box();
      const onTop = p.onGround && Math.abs(p.y - this.hull.y) < 2;
      if (pb && !onTop && Math.abs(p.x - this.x) < 46 && p.y > this.y - 34) {
        if (this.state === 'charge' || this.state === 'enter') p.hurt(g, this.x);
        else {
          const side = Math.sign(p.x - this.x) || -this.facing;
          const target = this.x + side * 46;
          p.x += Math.max(-3, Math.min(3, target - p.x));
        }
      }
    } else this.hull.alive = false;
  }
  pickAttack() {
    const low = this.hp < this.maxHp * 0.5;
    const opts: typeof this.state[] = ['cannon', 'flat', 'mg', 'hatch'];
    if (low) opts.push('rev', 'rev');
    let n = opts[this.nextAtk % opts.length];
    this.nextAtk += 1 + ((Math.random() * 2) | 0);
    if (n === 'rev' && !low) n = 'mg';
    this.state = n;
    this.st = 0;
  }
  toIdle() {
    this.state = 'idle';
    this.st = this.hp < this.maxHp * 0.5 ? 20 : 0;
  }
  muzzle() {
    const a = this.barrel;
    const bx = 4, by = -52;
    return { x: this.x + this.facing * (bx + Math.cos(a) * 34), y: this.y + by + Math.sin(a) * 34 };
  }
  private drawTurret(R: Rig, g: Game) {
    // kettle-shaped turret with a spout cannon; coordinates relative to turret pivot
    const col = C.tin;
    const a = this.barrel;
    const bx = 4, by = -18;
    R.limb(v(bx, by), v(bx + Math.cos(a) * 34, by + Math.sin(a) * 34), 5, C.gun);
    R.bare(v(bx + 2, by - 1), v(bx + Math.cos(a) * 30, by + Math.sin(a) * 30 - 1), 1, C.gunHi);
    R.orect(Math.round(bx + Math.cos(a) * 31) - 2, Math.round(by + Math.sin(a) * 31) - 3, 5, 6, C.gunSh);
    R.odisc(0, -14, 15, col);
    R.disc(-4, -18, 9, C.tinHi);
    R.orect(-18, -6, 36, 6, C.tinSh);
    // crown crest
    R.orect(-3, -31, 6, 3, C.crest);
    R.px(-2, -33, C.crest); R.px(2, -33, C.crest); R.px(0, -34, C.crest);
    // rivets
    for (let i = -12; i <= 12; i += 6) R.px(i, -4, C.tinHi);
    void g;
  }
  draw(g: Game, s: Surface) {
    if (this.state === 'wait') {
      // where it will burst out and roll to
      if (this.rumble) lane(s, this.arenaR - 110 - 46, this.x + 40, this.y - 33, this.y, g.t, -1, 0.6);
      return;
    }
    const R = tankRig;
    R.begin();
    const col = C.tin;
    const dark = C.tinSh;
    const rk = Math.round(this.rock);
    // ---- turret (with commander)
    const tOx = R.ox, tOy = R.oy;
    R.ox = tOx + 2 + rk;
    R.oy = tOy - 36;
    const wrecked = this.state === 'dying' && this.st >= 60;
    if (this.hatchUp > 0 && !wrecked) {
      const up = Math.round(this.hatchUp * 12);
      R.sprite(HEAD_TIN, -8, -40 - up + 12);
      R.limb(v(-3, -30 - up + 14), v(-3, -24 - up + 14), 5, C.uni);
      if (this.state === 'hatch' && (this.st % 30) < 12) R.limb(v(-1, -28 - up + 14), v(4, -38 - up + 14), 2, C.eskin);
    }
    if (!wrecked) this.drawTurret(R, g);
    else {
      // torn turret ring
      R.orect(-16, -4, 32, 4, C.gunSh);
      R.rect(-12, -3, 24, 2, (g.t & 4) ? C.fire3 : C.fire4);
    }
    R.ox = tOx; R.oy = tOy;
    // ---- hull
    R.orect(-44, -36 + rk, 88, 22, col);
    R.rect(-44, -36 + rk, 88, 3, C.tinHi);
    R.rect(-44, -18 + rk, 88, 4, dark);
    // sloped front armor + plate
    if (this.armor) {
      R.orect(34, -34 + rk, 12, 18, C.steel);
      R.px(37, -30 + rk, C.tinHi); R.px(37, -21 + rk, C.tinHi); R.px(42, -30 + rk, C.tinHi); R.px(42, -21 + rk, C.tinHi);
    } else {
      // exposed guts
      R.orect(34, -32 + rk, 9, 14, C.rustSh);
      R.rect(35, -30 + rk, 3, 3, (g.t & 4) ? C.fire2 : C.fire3);
    }
    // hull MG port
    R.orect(42, -12 + rk, 8, 3, C.gunSh);
    if (this.state === 'mg' && this.st > 16 && this.st < 60 && (g.t & 2)) R.disc(50, -11 + rk, 3, C.fire1);
    // exhaust stack
    R.orect(-36, -46 + rk, 6, 12, dark);
    R.rect(-37, -47 + rk, 8, 2, C.gunSh);
    // tin-crown emblem
    R.orect(-14, -32 + rk, 10, 8, C.teal);
    R.rect(-11, -30 + rk, 4, 2, C.crest);
    // ---- treads
    R.orect(-46, -15, 92, 15, C.gunSh);
    R.rect(-44, -14, 88, 2, C.gun);
    const off = ((Math.round(this.tread) % 6) + 6) % 6;
    for (let i = -44 + off; i < 44; i += 6) { R.rect(i, -15, 2, 1, C.gunHi); R.rect(i, -1, 2, 1, C.gunHi); }
    for (let i = 0; i < 6; i++) {
      const wx = -36 + i * 14.4;
      R.odisc(wx, -7, 5, C.steel);
      const a = this.tread * 0.2 + i;
      R.line(v(wx - Math.cos(a) * 4, -7 - Math.sin(a) * 4), v(wx + Math.cos(a) * 4, -7 + Math.sin(a) * 4), C.steelSh);
      R.px(wx, -7, C.steelHi);
    }
    R.present(s, this.x, this.y, this.facing < 0, wrecked ? { mode: Mode.Tint, color: C.black, amount: 0.55 } : hitTint(this.flash, g.t));
    if (wrecked) return;
    // muzzle glow during telegraph
    if ((this.state === 'cannon' && this.st > 20 && this.st < 44) || (this.state === 'flat' && this.st > 14 && this.st < 36)) {
      const m = this.muzzle();
      if (g.t & 2) s.disc(m.x, m.y, 3, C.fire1);
      s.glow(m.x, m.y, 18, 90, 50, 10);
    }
    // danger lanes (bands match the real hit heights)
    const f = this.facing;
    const front = this.x + f * 46;
    const edge = f < 0 ? s.ox : s.ox + W;
    if (this.state === 'flat' && this.st < 40) {
      // shell at chest height: crouch under it
      lane(s, front, edge, this.y - 29, this.y - 19, g.t, f, Math.min(1, this.st / 36));
    }
    if (this.state === 'mg' && this.st < MG_WARN + 44) {
      // low stream: jump over it
      lane(s, front, edge, this.y - 13, this.y - 5, g.t, f, Math.min(1, this.st / MG_WARN));
      if (this.st < MG_WARN && (g.t & 4)) s.disc(this.x + f * 47, this.y - 10, 2, C.ebul);
    }
    if (this.state === 'rev') {
      // charge path: hop onto the hull or get out of the way
      lane(s, front, f < 0 ? this.arenaL + 24 : this.arenaR - 24, this.y - 33, this.y, g.t, f, Math.min(1, this.st / 40));
    }
  }
}
const GROUND_Y = 184;
const MG_WARN = 26;
const PLATE = bake((() => { const p = new Surface(12, 18); p.clear(C.steel); for (let y = 0; y < 18; y++) p.px[y * 12] = C.steelHi; p.px[3 * 12 + 3] = C.tinHi; return p; })());

// =================================================================== Rail draisine (train chase)
const draiRig = new Rig(120, 70, 60, 60);
export class Draisine extends Ent {
  maxHp = 55;
  st = 0;
  state: 'enter' | 'fight' | 'ram' | 'dying' = 'enter';
  pump = 0;
  cd = 60;
  burst = 0;
  warn = 0;
  spin = 0;
  onDead: (() => void) | null = null;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.hp = this.maxHp;
    this.team = 'enemy';
    this.hittable = true;
    this.counts = true;
    this.z = 33;
    this.score = 5000;
  }
  box(): Rect | null { return this.state === 'dying' ? null : { x: this.x - 36, y: this.y - 64, w: 76, h: 56 }; }
  // move toward a target x at a capped speed (never teleport)
  private ease(tx: number, max: number) {
    this.x += Math.max(-max, Math.min(max, (tx - this.x) * 0.2));
  }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player' || this.state === 'dying') return null;
    this.hp -= h.dmg * (h.y < this.y - 34 ? 1.3 : 1);
    this.flash = 4;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.st = 0;
      this.hittable = false;
      this.counts = false;
      g.kills++;
      g.addScore(this.score, this.x, this.y - 50);
      g.hitstop(8);
      g.flash(4);
      g.explode(this.x, this.y - 20, 40, 0, 'player', { scale: 2.2 });
      this.vy = -5;
      this.vx = -1.5;
    }
    return h.y < this.y - 34 ? 'flesh' : 'metal';
  }
  update(g: Game) {
    this.st++;
    this.pump += this.state === 'ram' ? 0.4 : 0.18;
    const p = g.player;
    const home = g.cam.x + 14;
    if (this.state === 'enter') {
      this.x += (home - this.x) * 0.03 + 0.3;
      if (Math.abs(this.x - home) < 4) { this.state = 'fight'; this.st = 0; }
    } else if (this.state === 'fight') {
      this.ease(home + Math.sin(this.st * 0.02) * 10, 1.2);
      if (this.warn > 0 && --this.warn === 0) this.burst = 6;
      if (--this.cd <= 0) {
        if (this.hp < this.maxHp * 0.5 && Math.random() < 0.4) { this.state = 'ram'; this.st = 0; }
        else if (Math.random() < 0.6) { this.warn = BURST_WARN; g.snd('clank', this.x, 0.4, 1.3); }
        else {
          const sx = this.x + 14, sy = this.y - 60;
          const T = 48;
          g.add(new Grenade(sx, sy, (p.x - sx) / T, (p.y - sy - 0.08 * T * T) / T, 'enemy'));
          g.snd('throw', this.x, 0.5);
        }
        this.cd = 90 + Math.random() * 50;
      }
      if (this.burst > 0 && this.st % 6 === 0) {
        this.burst--;
        // flat bursts at chest height: crouch under them (crouching clears it by 4px)
        const mx = this.x + 42, my = this.y - 50;
        g.add(new EBullet(mx, my, 2.8, 0));
        g.snd('gat', this.x, 0.4, 0.8);
      }
    } else if (this.state === 'ram') {
      // telegraph: sparks, then lunge at our car
      if (this.st < 40) {
        if (this.st % 3 === 0) g.fx.sparks(this.x + 20, this.y, 3, -Math.PI * 0.75, 0.4, 3);
        this.ease(home - this.st * 0.3, 1.5);
      } else if (this.st < 60) {
        this.x += 3;
        if (this.x > home + 24) {
          g.shake(6);
          g.snd('slam', this.x, 0.7);
          this.st = 60;
        }
        const pb = p.box();
        if (pb && p.x < this.x + 44 && p.y > this.y - 56) p.hurt(g, this.x);
      } else if (this.st > 90) { this.state = 'fight'; this.st = 0; this.cd = 60; }
    } else if (this.state === 'dying') {
      this.vy += 0.2;
      this.x += this.vx - 2;
      this.y += this.vy;
      this.spin -= 0.12;
      if (this.st % 6 === 0) g.explode(this.x + (Math.random() - 0.5) * 40, this.y - 20, 20, 0, 'player', { scale: 1.2, noScorch: true });
      if (this.st > 80) { this.dead = true; if (this.onDead) this.onDead(); }
    }
    if (this.state !== 'dying' && this.st % 3 === 0 && Math.random() < 0.5) g.fx.sparks(this.x + (Math.random() < 0.5 ? -24 : 24), this.y, 1, -Math.PI * 0.8, 0.3, 2);
  }
  draw(g: Game, s: Surface) {
    const R = draiRig;
    R.begin();
    const col = C.rust;
    // wheels
    for (const wx of [-24, 24]) {
      R.odisc(wx, -6, 6, C.gunSh);
      R.disc(wx, -6, 3, C.steel);
      const a = g.t * 0.5;
      R.line(v(wx - Math.cos(a) * 5, -6 - Math.sin(a) * 5), v(wx + Math.cos(a) * 5, -6 + Math.sin(a) * 5), C.gunSh);
    }
    // chassis + deck
    R.orect(-34, -18, 68, 6, C.gunSh);
    R.orect(-38, -28, 78, 6, col);
    R.rect(-38, -28, 78, 1, C.fire3);
    R.rect(-38, -24, 78, 2, C.rustSh);
    // pump handle see-saw with two comedic pumpers
    const ph = Math.sin(this.pump * 3) * 5;
    R.limb(v(-4, -44), v(-4, -28), 2, C.gunSh);
    R.limb(v(-16, -44 + ph), v(8, -44 - ph), 2, C.steel);
    for (const [px, hy] of [[-18, ph], [10, -ph]] as [number, number][]) {
      R.limb(v(px, -28), v(px + 1, -36), 3, C.epants);
      R.limb(v(px + 1, -36), v(px + 1, -44), 5, C.uni);
      R.sprite(HEAD_TIN, px - 4, -54 + (hy > 0 ? 1 : 0));
      R.limb(v(px + 2, -42), v(px + (px < 0 ? 2 : -2), -44 + hy), 2, C.eskin);
    }
    // MG + gunner behind a sandbag
    R.limb(v(26, -28), v(26, -36), 3, C.epants);
    R.limb(v(26, -36), v(26, -44), 5, C.uni);
    R.sprite(HEAD_TIN, 21, -54);
    R.limb(v(28, -46), v(44, -47), 3, C.gun);
    R.orect(24, -50, 8, 5, C.tinSh);
    if (this.burst > 0 && (g.t & 2)) R.disc(46, -47, 3, C.fire1);
    R.orect(32, -36, 8, 8, C.sand);
    R.presentRot(s, this.x, this.y, -30, this.spin, false, hitTint(this.flash, g.t));
    if (this.state === 'dying') return;
    // telegraphs
    if (this.warn > 0 || this.burst > 0) {
      // chest-height stream across the flatcar: crouch
      lane(s, this.x + 46, s.ox + W, this.y - 55, this.y - 45, g.t, 1, this.burst > 0 ? 1 : 1 - this.warn / BURST_WARN);
      if (this.warn > 0 && (g.t & 4)) s.disc(this.x + 46, this.y - 50, 2, C.ebul);
    }
    if (this.state === 'ram' && this.st < 60) {
      lane(s, this.x + 40, this.x + 110, this.y - 58, this.y - 28, g.t, 1, Math.min(1, this.st / 40));
      alertBadge(s, this.x + 20, this.y - 70, g.t);
    }
  }
}
const BURST_WARN = 24;

// =================================================================== HORNET gunship
const heliRig = new Rig(180, 100, 90, 56);
export class Gunship extends Ent {
  maxHp = 180;
  state: 'enter' | 'strafe' | 'missiles' | 'drop' | 'sweep' | 'dying' = 'enter';
  st = 0;
  tx = 0;
  ty = 50;
  facing = -1;
  tilt = 0;
  gunA = Math.PI / 2;
  seq = 0;
  onDead: (() => void) | null = null;
  lock = 0;
  safeX = 0;
  constructor(x: number, y: number) {
    super();
    this.x = x; this.y = y;
    this.hp = this.maxHp;
    this.team = 'enemy';
    this.hittable = true;
    this.counts = true;
    this.z = 52;
    this.score = 20000;
  }
  box(): Rect | null { return this.state === 'dying' ? null : { x: this.x - 44, y: this.y - 20, w: 88, h: 34 }; }
  onHit(g: Game, h: Hit): Mat | null {
    if (h.from !== 'player' || this.state === 'dying' || this.state === 'enter') return null;
    this.hp -= h.dmg;
    this.flash = 4;
    if (this.hp <= 0) {
      this.state = 'dying';
      this.st = 0;
      this.hittable = false;
      this.counts = false;
      g.kills++;
      g.addScore(this.score, this.x, this.y);
      g.hitstop(10);
      g.flash(5);
      g.shake(8);
      g.explode(this.x, this.y, 30, 0, 'player', { scale: 1.8 });
      audio.play('expl_l');
    }
    return 'metal';
  }
  next(g: Game) {
    const low = this.hp < this.maxHp * 0.5;
    const order: typeof this.state[] = low ? ['strafe', 'missiles', 'sweep', 'drop', 'missiles', 'sweep'] : ['strafe', 'missiles', 'drop', 'strafe', 'missiles'];
    this.state = order[this.seq++ % order.length];
    this.st = 0;
    const cx = g.cam.x;
    if (this.state === 'strafe') { this.tx = cx + (this.x > cx + 192 ? 80 : 300); this.ty = 50; }
    if (this.state === 'missiles') { this.tx = cx + (Math.random() < 0.5 ? 300 : 90); this.ty = 44; }
    if (this.state === 'drop') { this.tx = cx + 230; this.ty = 58; }
    if (this.state === 'sweep') { this.tx = cx + 340; this.ty = 70; }
  }
  update(g: Game) {
    this.st++;
    const p = g.player;
    const cx = g.cam.x;
    const low = this.hp < this.maxHp * 0.5;
    if (this.state === 'dying') {
      this.x -= 1.5 + this.st * 0.03;
      this.y += 0.5 + this.st * 0.02;
      this.tilt += 0.08;
      if (this.st % 5 === 0) g.explode(this.x + (Math.random() - 0.5) * 60, this.y + (Math.random() - 0.5) * 20, 18, 0, 'player', { scale: 1, noScorch: true, silent: this.st % 10 !== 0 });
      g.fx.smoke(this.x, this.y, 1, 5, C.smoke2, 0.2);
      if (this.st === 90) {
        g.explode(this.x, this.y, 60, 0, 'player', { scale: 3, noScorch: true });
        g.fx.splash(this.x, this.y + 20, 40, 2.4);
        g.snd('splash', this.x, 1);
        g.flash(6, C.fire1);
        g.shake(10);
        this.dead = true;
        if (this.onDead) this.onDead();
      }
      return;
    }
    if (this.age % 18 === 0) g.snd('heli', this.x, 0.35, 1);
    if (low && this.age % 4 === 0) g.fx.smoke(this.x - 20, this.y - 12, 1, 4, C.smoke2, 0.1);
    if (this.hp < this.maxHp * 0.3 && this.age % 3 === 0) g.fx.add({ t: PT.Fire, x: this.x - 18, y: this.y - 12, vx: -2, life: 10, size: 3, c: C.fire2 });

    if (this.state === 'enter') {
      this.tx = cx + 290;
      this.ty = 50;
      if (this.st > 90) this.next(g);
    }
    // steer toward the target point
    const ax = Math.max(-0.12, Math.min(0.12, (this.tx - this.x) * 0.004));
    this.vx = (this.vx + ax) * 0.95;
    this.x += this.vx;
    this.y += (this.ty + Math.sin(this.age * 0.05) * 4 - this.y) * 0.05;
    this.tilt = Math.max(-0.3, Math.min(0.3, this.vx * 0.12));
    const gx = this.x - 20, gy = this.y + 16;
    const ta = Math.atan2(p.y - 16 - gy, p.x - gx);
    this.gunA += Math.max(-0.05, Math.min(0.05, ta - this.gunA));

    switch (this.state) {
      case 'strafe': {
        // aimed 3-round bursts with a laser-sight telegraph
        const ph = this.st % 70;
        this.lock = ph < 30 ? ph : 0;
        if (ph >= 34 && ph < 46 && ph % 4 === 2) {
          g.add(new EBullet(gx + Math.cos(this.gunA) * 8, gy + Math.sin(this.gunA) * 8, Math.cos(this.gunA) * 2.9, Math.sin(this.gunA) * 2.9));
          g.snd('gat', this.x, 0.4, 0.9);
        }
        if (this.st > 70 * 3) this.next(g);
        break;
      }
      case 'missiles': {
        if (this.st === 30 || this.st === 60 || (low && this.st === 90)) {
          for (const side of [-1, 1]) {
            const mx = this.x + side * 16, my = this.y + 8;
            const a = Math.atan2(p.y - 12 - my, p.x - mx);
            g.add(new ERocket(mx, my, a, 2.6));
          }
          g.snd('rocket', this.x, 0.7, 0.9);
        }
        if (this.st > 130) this.next(g);
        break;
      }
      case 'drop': {
        // side door slides open first, then troopers jump out of it
        if (this.st === 24) g.snd('clank', this.x, 0.4, 0.8);
        if (this.st === 40 || this.st === 70) {
          const s = new Soldier(this.x + (this.st === 40 ? -4 : 4), this.y + 14, this.st === 40 ? 'rifle' : 'grenadier', 'none', -1);
          s.enter('jump', -0.3, 0);
          s.tag = 'heli';
          s.origin = 'vehicle';
          g.add(s);
          g.snd('throw', this.x, 0.4, 0.5);
        }
        if (this.st > 110) this.next(g);
        break;
      }
      case 'sweep': {
        // Telegraph: hover at the right edge while the strafing run is painted on the deck.
        // The run always leaves one safe gap, placed near where the player is standing.
        if (this.st === 1) {
          this.safeX = Math.max(cx + 50, Math.min(cx + 330, p.x + (Math.random() - 0.5) * 90));
          g.snd('alert', this.x, 0.6, 0.7);
        }
        if (this.st < SWEEP_WARN) {
          this.tx = cx + 350;
          this.ty = 60;
          break;
        }
        // dive across the deck raking straight down, holding fire over the safe gap
        this.tx = cx - 60;
        this.ty = 68;
        this.vx = Math.min(this.vx, -1.6);
        const bx = this.x - 6;
        if (this.st % 4 === 0 && bx > cx + 10 && bx < cx + 374 && Math.abs(bx - this.safeX) > SWEEP_GAP) {
          g.add(new EBullet(bx, this.y + 18, 0, 3.2));
          g.snd('gat', this.x, 0.35, 0.8);
        }
        if (this.x < cx - 40) { this.x = cx + 440; this.y = 40; this.next(g); }
        break;
      }
    }
  }
  draw(g: Game, s: Surface) {
    const R = heliRig;
    R.begin();
    const col = C.teal;
    const sh = C.tealSh;
    // tail boom (to the right since it faces left; we draw facing right and flip)
    R.limb(v(-20, -4), v(-62, -8), 5, sh);
    R.limb(v(-60, -8), v(-66, -18), 4, sh);
    const tr = (g.t >> 1) & 1;
    if (this.state !== 'dying') { R.bare(v(-66, -26), v(-66, -10), 1, tr ? C.steelHi : C.gunSh); R.bare(v(-72, -18), v(-60, -18), 1, tr ? C.gunSh : C.steelHi); }
    // body
    R.odisc(0, 0, 18, col);
    R.orect(-24, -12, 36, 22, col);
    R.disc(-4, -6, 11, C.teal);
    R.rect(-22, -10, 30, 2, hexHi);
    R.rect(-24, 6, 40, 4, sh);
    // cockpit
    R.orect(8, -10, 12, 11, C.glassSh);
    R.rect(9, -9, 4, 9, C.glass);
    R.sprite(HEAD_TIN, 6, -12);
    // stub wing + pods
    R.orect(-12, 4, 28, 3, sh);
    R.orect(-14, 7, 10, 5, C.tinSh);
    R.orect(8, 7, 10, 5, C.tinSh);
    R.px(-14, 9, C.ebul); R.px(18, 9, C.ebul);
    // skids
    R.bare(v(-18, 18), v(16, 18), 1, C.gunSh);
    R.bare(v(-12, 12), v(-12, 18), 1, C.gunSh);
    R.bare(v(8, 12), v(8, 18), 1, C.gunSh);
    // emblem
    R.orect(-18, -4, 7, 6, C.crest);
    // side door slides open while troopers drop out
    if (this.state === 'drop' && this.st > 24 && this.st < 96) {
      R.orect(-8, -9, 11, 15, C.black);
      R.rect(-8, -9, 11, 2, C.stoneDk);
    }
    // main rotor
    R.limb(v(0, -18), v(0, -24), 2, C.gunSh);
    const L = [70, 40, 64, 20][(g.t >> 1) & 3];
    if (this.state !== 'dying' || (g.t & 1)) {
      R.bare(v(-L, -25), v(L, -25), 1, C.gunSh);
      R.bare(v(-L * 0.8, -26), v(L * 0.8, -26), 1, C.steelHi);
    }
    R.presentRot(s, this.x, this.y, 0, -this.tilt, true, hitTint(this.flash, g.t));
    // chin gun (world space so it aims freely)
    const gx = this.x - 20, gy = this.y + 16;
    s.othick(gx, gy, gx + Math.cos(this.gunA) * 9, gy + Math.sin(this.gunA) * 9, 2, C.gun);
    if (this.state === 'strafe' && this.lock > 0) {
      // laser sight: tracks the player, turns solid ~14 frames before the burst
      aimLine(s, gx, gy, this.gunA, 230, g.t, this.lock > 16);
    }
    if (this.state === 'sweep') {
      // painted strafing run on the deck with one clear gap
      const cx = s.ox, y = DECK_Y_WORLD;
      const k = Math.min(1, this.st / SWEEP_WARN);
      const l1 = cx + 10, r1 = this.safeX - SWEEP_GAP, l2 = this.safeX + SWEEP_GAP, r2 = cx + 374;
      const visL = this.st < SWEEP_WARN ? cx + W : this.x - 6;
      if (r1 > l1) lane(s, l1, Math.min(r1, visL), y - 4, y, g.t, -1, k);
      if (r2 > l2) lane(s, l2, Math.min(r2, visL), y - 4, y, g.t, -1, k);
      if (this.st < SWEEP_WARN) alertBadge(s, this.x - 26, this.y + 24, g.t);
    }
  }
}
const SWEEP_WARN = 50;
const SWEEP_GAP = 26;
const DECK_Y_WORLD = 172;
const hexHi = C.steelHi;
