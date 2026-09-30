import { Surface, Mode } from '../engine/surface';
import { audio } from '../engine/audio';
import { C } from './palette';
import { Ent, type Rect } from './types';
import { Rig, ik, v, type V, HEAD_PLAYER, HEAD_PLAYER_HURT, HEAD_PLAYER_YELL } from './puppet';
import { PBullet, Rocket, Grenade, FlameShot, WEAPONS, type WeaponId } from './weapons';
import { PT } from './fx';
import { W, type Body, type Game } from './world';

type PState = 'play' | 'slide' | 'dead' | 'respawn' | 'victory' | 'cut';

const RUN = 1.75;
const JUMP_V = -4.5;
const rig = new Rig(80, 72, 40, 60);

const GUN_LEN: Record<WeaponId, number> = { pistol: 8, gat: 15, scatter: 14, rocket: 13, flame: 13 };

export class Player extends Ent implements Body {
  w = 12;
  h = 30;
  onGround = false;
  dropT = 0;
  wall = 0;
  facing = 1;
  state: PState = 'respawn';
  crouch = false;
  aimAng = 0;
  aimT = 0;
  weapon: WeaponId = 'pistol';
  ammo = 0;
  bombs = 10;
  fireCd = 0;
  holdT = 0;
  recoil = 0;
  muzzleF = 0;
  muzzleKind = 0;
  pumpT = 0;
  throwT = 0;
  knifeT = 0;
  knifeAlt = false;
  coyote = 0;
  slideT = 0;
  slideCd = 0;
  inv = 0;
  runPhase = 0;
  landT = 0;
  deadT = 0;
  spin = 0;
  lean = 0;
  leanV = 0;
  airT = 0;
  stepT = 0;
  gatAlt = 0;
  control = true;
  scarf: { x: number; y: number; px: number; py: number }[] = [];
  flameSnd = 0;
  victoryT = 0;
  walkTo: number | null = null;

  constructor() {
    super();
    this.team = 'player';
    this.z = 40;
  }

  box(): Rect | null {
    if (this.state === 'dead' || this.state === 'victory') return null;
    const low = this.crouch || this.state === 'slide';
    const h = low ? 17 : this.h;
    return { x: this.x - this.w / 2, y: this.y - h, w: this.w, h };
  }

  spawnAt(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.state = 'respawn';
    this.inv = 100;
    this.scarf = [];
  }

  respawn(g: Game) {
    this.x = g.cam.x + 70;
    this.y = g.cam.y - 20;
    this.vx = 0;
    this.vy = 1;
    this.state = 'respawn';
    this.inv = 150;
    this.weapon = 'pistol';
    this.ammo = 0;
    this.bombs = 10;
    this.deadT = 0;
    this.spin = 0;
    this.scarf = [];
    // courtesy: clear enemy bullets on screen
    for (const e of g.ents) if (e.team === 'enemy' && !e.hittable && (e.constructor.name === 'EBullet')) e.dead = true;
  }

  giveWeapon(g: Game, w: WeaponId) {
    if (this.weapon === w) this.ammo += WEAPONS[w].ammo;
    else {
      this.weapon = w;
      this.ammo = WEAPONS[w].ammo;
    }
    audio.voice(WEAPONS[w].voice, { priority: true });
    g.snd('weapon', this.x, 0.6);
  }

  // returns true if the hit was taken
  hurt(g: Game, fromX: number): boolean {
    if (this.inv > 0 || this.state === 'dead' || this.state === 'victory' || this.state === 'cut' || g.god) return false;
    if (this.state === 'slide' && this.slideT < 14) return false; // slide i-frames
    this.state = 'dead';
    this.deadT = 0;
    g.deathLog.push({ x: Math.round(this.x), t: g.t, area: g.stage.area, cause: g.hurtCause });
    const d = Math.sign(this.x - fromX) || -this.facing;
    this.vx = d * 1.8;
    this.vy = -3.6;
    this.onGround = false;
    this.spin = 0;
    g.hitstop(9);
    g.shake(6);
    g.flash(4, C.white);
    g.snd('hitheavy', this.x, 1);
    audio.voice('hero_die', { fallback: 'scream' });
    g.fx.star(this.x, this.y - 18, 12, 5);
    g.fx.sparks(this.x, this.y - 18, 10, -Math.PI / 2, Math.PI, 3, C.fire1);
    return true;
  }

  // ------------------------------------------------------------------ update
  update(g: Game) {
    const inp = g.input;
    if (this.inv > 0) this.inv--;
    if (this.fireCd > 0) this.fireCd--;
    if (this.recoil > 0) this.recoil *= 0.6;
    if (this.recoil < 0.3) this.recoil = 0;
    if (this.muzzleF > 0) this.muzzleF--;
    if (this.pumpT > 0) this.pumpT--;
    if (this.throwT > 0) this.throwT--;
    if (this.knifeT > 0) this.knifeT--;
    if (this.landT > 0) this.landT--;
    if (this.slideCd > 0) this.slideCd--;

    if (this.state === 'dead') return this.updateDead(g);
    if (this.state === 'victory') {
      this.victoryT++;
      this.vx *= 0.8;
      this.vy += 0.3;
      g.moveBody(this);
      this.updateScarf(g);
      return;
    }

    const ctl = this.control && this.state !== 'cut';
    let dirX = ctl ? (inp.down('right') ? 1 : 0) - (inp.down('left') ? 1 : 0) : 0;
    if (this.walkTo !== null) {
      dirX = Math.abs(this.walkTo - this.x) > 2 ? Math.sign(this.walkTo - this.x) : 0;
      if (dirX === 0) this.walkTo = null;
    }
    const up = ctl && inp.down('up');
    const down = ctl && inp.down('down');

    if (this.state === 'respawn') {
      // dropping in from above; controllable in air
      if (this.onGround) {
        this.state = 'play';
        this.landT = 8;
        g.fx.dust(this.x, this.y, 6);
        g.snd('land', this.x, 0.6);
      }
    }

    // ---- slide
    if (this.state === 'slide') {
      this.slideT++;
      this.vx *= 0.93;
      if (this.slideT % 3 === 0) g.fx.dust(this.x - this.facing * 4, this.y, 1, -this.facing);
      const canJump = ctl && inp.buffered('jump');
      if (canJump && this.onGround) {
        inp.consume('jump');
        this.state = 'play';
        this.jump(g, 1.15);
      } else if (this.slideT > 22 || Math.abs(this.vx) < 0.9 || !this.onGround) {
        this.state = 'play';
        this.slideCd = 14;
        this.landT = 4;
      }
    }

    if (this.state === 'play' || this.state === 'respawn') {
      if (dirX !== 0 && this.knifeT === 0) this.facing = dirX;
      this.crouch = this.onGround && down && this.state === 'play';
      const target = dirX * (this.crouch ? 0.85 : RUN);
      const accel = this.onGround ? (Math.sign(target) !== Math.sign(this.vx) && this.vx !== 0 ? 0.6 : 0.45) : 0.28;
      if (this.vx < target) this.vx = Math.min(target, this.vx + accel);
      else if (this.vx > target) this.vx = Math.max(target, this.vx - accel);

      // jump (buffered + coyote)
      if (ctl && inp.buffered('jump') && (this.onGround || this.coyote > 0)) {
        inp.consume('jump');
        if (down && this.onGround && this.onOneway(g)) {
          this.dropT = 12;
          this.onGround = false;
          this.vy = 1;
        } else this.jump(g, 1);
      }
      // slide
      if (ctl && inp.pressed('slide') && this.onGround && this.slideCd === 0 && this.state === 'play') {
        this.state = 'slide';
        this.slideT = 0;
        this.crouch = false;
        this.vx = this.facing * 4.3;
        g.snd('slide', this.x, 0.5);
        g.fx.dust(this.x, this.y, 5, -this.facing);
      }
    }

    // gravity with variable jump height
    const jumpHeld = ctl && inp.down('jump');
    if (this.vy < 0) this.vy += jumpHeld ? 0.23 : 0.55;
    else this.vy += 0.3;
    if (this.vy > 5.5) this.vy = 5.5;

    // ---- aim
    let aimTarget = 0;
    if (up) aimTarget = dirX !== 0 && this.weapon !== 'gat' ? -Math.PI / 4 : -Math.PI / 2;
    else if (down && !this.onGround) aimTarget = Math.PI / 2;
    if (this.state === 'slide') aimTarget = 0;
    if (this.weapon === 'gat') {
      // the heavy gun sweeps between directions, spraying a fan (signature move)
      const d = aimTarget - this.aimAng;
      this.aimAng += Math.max(-0.2, Math.min(0.2, d));
    } else this.aimAng = aimTarget;

    // ---- attacks
    if (ctl && this.state !== 'respawn') {
      if (inp.buffered('fire')) this.tryFire(g, true);
      else if (inp.down('fire')) this.tryFire(g, false);
      if (!inp.down('fire')) this.holdT = 0;
      if (inp.pressed('bomb') && this.bombs > 0 && this.throwT === 0 && this.knifeT === 0) this.throwBomb(g);
    }
    if (this.weapon === 'flame') {
      this.flameSnd = Math.max(0, this.flameSnd - 1);
      audio.loop('flame', this.flameSnd > 0 ? 0.5 : 0);
    }

    const wasGround = this.onGround;
    const fallV = this.vy;
    g.moveBody(this);
    if (this.onGround) {
      this.coyote = 6;
      this.airT = 0;
    } else {
      if (this.coyote > 0) this.coyote--;
      this.airT++;
    }
    if (!wasGround && this.onGround && fallV > 1.5) {
      this.landT = fallV > 4 ? 7 : 5;
      g.fx.dust(this.x - 4, this.y, 2, -1);
      g.fx.dust(this.x + 4, this.y, 2, 1);
      g.snd('land', this.x, Math.min(0.7, fallV * 0.12));
      this.leanV += 0.6;
    }
    // keep inside the screen
    const minX = g.cam.x + 6, maxX = g.cam.x + W - 6;
    if (this.x < minX) { this.x = minX; if (this.vx < 0) this.vx = 0; }
    if (this.x > maxX && g.cam.lockL >= 0) { this.x = maxX; if (this.vx > 0) this.vx = 0; }
    if (this.y > g.cam.y + 300 && this.state !== 'respawn') this.hurt(g, this.x);

    // run cycle + footsteps
    if (this.onGround && Math.abs(this.vx) > 0.2) {
      const prev = this.runPhase;
      this.runPhase = (this.runPhase + Math.abs(this.vx) / 22) % 1;
      if ((prev < 0.5 && this.runPhase >= 0.5) || this.runPhase < prev) {
        g.snd('step', this.x, 0.25);
        if (Math.abs(this.vx) > 1.2 && Math.random() < 0.6) g.fx.dust(this.x - this.facing * 3, this.y, 1, -this.facing);
      }
    }
    // body lean spring (follow-through when stopping / turning)
    const leanT = (this.vx * this.facing) * 0.9 - this.recoil * 0.4;
    this.leanV += (leanT - this.lean) * 0.25;
    this.leanV *= 0.7;
    this.lean += this.leanV;
    this.updateScarf(g);
  }

  private onOneway(g: Game) {
    for (const s of g.solids) {
      if (!s.alive) continue;
      if (Math.abs(s.y - this.y) < 1 && this.x > s.x && this.x < s.x + s.w) return s.oneway;
    }
    return false;
  }

  private jump(g: Game, mult: number) {
    this.vy = JUMP_V;
    this.vx *= mult;
    this.onGround = false;
    this.coyote = 0;
    this.airT = 0;
    this.crouch = false;
    g.fx.dust(this.x, this.y, 3, 0);
    g.snd('jump', this.x, 0.35);
  }

  private updateDead(g: Game) {
    this.deadT++;
    this.vy += 0.25;
    if (!this.onGround) this.spin += this.vx * 0.09 + 0.02 * Math.sign(this.vx || 1);
    const wasGround = this.onGround;
    g.moveBody(this);
    // keep the death tumble on screen
    if (this.x < g.cam.x + 14) { this.x = g.cam.x + 14; this.vx = Math.abs(this.vx) * 0.3; }
    if (this.x > g.cam.x + W - 14) { this.x = g.cam.x + W - 14; this.vx = -Math.abs(this.vx) * 0.3; }
    if (this.onGround) {
      if (!wasGround) {
        g.fx.dust(this.x, this.y, 5);
        g.snd('land', this.x, 0.8);
        if (this.deadT < 60) {
          this.vy = -1.6;
          this.onGround = false;
        }
      }
      this.vx *= 0.8;
      // settle flat on the back
      // nearest horizontal orientation (lying flat)
      const target = Math.round((this.spin - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      this.spin += (target - this.spin) * 0.3;
    }
    if (this.deadT === 110) {
      g.lives--;
      if (g.lives > 0) this.respawn(g);
      else {
        g.setMode('continue');
        audio.voice('continue', { priority: true });
      }
    }
    this.updateScarf(g);
  }

  // Resolve the gun pose. All values in rig-local space (facing right, feet at 0,0).
  gunPose() {
    const low = this.crouch;
    const sliding = this.state === 'slide';
    const sh = sliding ? v(3, -12) : low ? v(3, -15) : v(1 + Math.round(this.lean * 0.6), -20 + (this.landT > 2 ? 2 : 0));
    const a = this.aimAng;
    const dir = v(Math.cos(a), Math.sin(a));
    const perp = v(-dir.y, dir.x);
    const r = this.recoil;
    // the pistol is held out at arm's length; heavy weapons are braced at the chest
    const reach = this.weapon === 'pistol' ? 7 : 4;
    const grip = v(sh.x + dir.x * reach + perp.x * 1.5 - dir.x * r, sh.y + dir.y * reach + perp.y * 1.5 - dir.y * r);
    const L = GUN_LEN[this.weapon];
    const muzzle = v(grip.x + dir.x * L, grip.y + dir.y * L);
    return { sh, grip, dir, perp, muzzle, L };
  }

  private meleeTarget(g: Game): Ent | null {
    const box: Rect = { x: this.facing > 0 ? this.x : this.x - 26, y: this.y - 30, w: 26, h: 30 };
    for (const e of g.ents) {
      if (e.dead || !e.meleeable || e.team !== 'enemy') continue;
      const b = e.box();
      if (b && b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y) return e;
    }
    return null;
  }

  private tryFire(g: Game, pressed: boolean) {
    if (this.knifeT > 0 || this.throwT > 6) return;
    const w = this.weapon;
    if (pressed && w !== 'flame' && this.state !== 'slide') {
      const t = this.meleeTarget(g);
      if (t) {
        g.input.consume('fire');
        return this.knife(g);
      }
    }
    if (this.fireCd > 0) return;
    if (pressed) g.input.consume('fire');
    this.holdT++;
    const { dir, perp, muzzle } = this.gunPose();
    const f = this.facing;
    const mx = this.x + muzzle.x * f, my = this.y + muzzle.y;
    const dx = dir.x * f, dy = dir.y;
    this.muzzleF = 3;
    this.muzzleKind = (this.muzzleKind + 1) % 3;
    g.shots++;
    switch (w) {
      case 'pistol': {
        const spread = (Math.random() - 0.5) * 0.04;
        const ca = Math.cos(spread), sa = Math.sin(spread);
        g.add(new PBullet(mx, my, (dx * ca - dy * sa) * 7.5, (dx * sa + dy * ca) * 7.5, 'pistol'));
        this.fireCd = pressed ? 5 : 9;
        this.recoil = 2;
        g.kick(-dx * 0.4, -dy * 0.4);
        g.snd('pistol', this.x, 0.55);
        g.fx.shell(this.x + f * 2, this.y - 22, f);
        g.fx.light(mx, my, 20, [120, 100, 40], 3);
        break;
      }
      case 'gat': {
        this.gatAlt = -this.gatAlt || 1;
        const spread = (Math.random() - 0.5) * 0.1;
        const ca = Math.cos(spread), sa = Math.sin(spread);
        const off = this.gatAlt * 1.5;
        g.add(new PBullet(mx + perp.x * f * off, my + perp.y * off, (dx * ca - dy * sa) * 8.5, (dx * sa + dy * ca) * 8.5, 'gat'));
        this.fireCd = 3;
        this.recoil = 2.5;
        g.kick(-dx * 0.7, -dy * 0.7);
        g.shake(0.8);
        g.snd('gat', this.x, 0.5);
        g.fx.shell(this.x + f * 3, this.y - 21, f, true);
        g.fx.light(mx, my, 26, [150, 110, 40], 3);
        if (--this.ammo <= 0) this.dropToPistol(g);
        break;
      }
      case 'scatter': {
        for (let i = 0; i < 6; i++) {
          const sp = (i / 5 - 0.5) * 0.46 + (Math.random() - 0.5) * 0.06;
          const ca = Math.cos(sp), sa = Math.sin(sp);
          const spd = 6.5 + Math.random() * 1.8;
          g.add(new PBullet(mx, my, (dx * ca - dy * sa) * spd, (dx * sa + dy * ca) * spd, 'pellet', 15 + ((Math.random() * 5) | 0)));
        }
        this.fireCd = 21;
        this.recoil = 6;
        this.pumpT = 14;
        this.vx -= dx * 1.2;
        g.kick(-dx * 3, -dy * 3);
        g.shake(3);
        g.snd('scatter', this.x, 0.85);
        g.snd('tonk', this.x, 0.35, 0.6);
        g.fx.smoke(mx + dx * 4, my + dy * 4, 4, 5, C.smoke0, 0.3);
        g.fx.sparks(mx, my, 6, Math.atan2(dy, dx), 0.35, 4, C.fire1);
        g.fx.light(mx, my, 44, [200, 140, 60], 5);
        g.later(9, () => g.fx.shell(this.x + f * 2, this.y - 20, f, true));
        if (--this.ammo <= 0) this.dropToPistol(g);
        break;
      }
      case 'rocket': {
        g.add(new Rocket(mx, my, Math.atan2(dy, dx)));
        this.fireCd = 22;
        this.recoil = 4;
        g.kick(-dx * 2, -dy * 2);
        g.shake(1.5);
        g.snd('rocket', this.x, 0.7);
        // back-blast
        g.fx.smoke(this.x - dx * 12, my - dy * 12, 5, 5, C.smoke0, 0.2);
        g.fx.light(mx, my, 30, [180, 130, 60], 4);
        if (--this.ammo <= 0) this.dropToPistol(g);
        break;
      }
      case 'flame': {
        g.add(new FlameShot(mx, my, dx * 5 + this.vx * 0.5, dy * 5 + (Math.random() - 0.5) * 0.4));
        this.fireCd = 2;
        this.recoil = 1;
        this.muzzleF = 2;
        this.flameSnd = 6;
        g.fx.light(mx + dx * 20, my + dy * 20, 50, [160, 90, 20], 3);
        if (this.holdT % 4 === 0) g.shake(0.6);
        this.ammo -= 1;
        if (this.ammo <= 0) this.dropToPistol(g);
        break;
      }
    }
  }

  private dropToPistol(g: Game) {
    this.weapon = 'pistol';
    this.ammo = 0;
    audio.loop('flame', 0);
    g.fx.text(this.x, this.y - 40, 'EMPTY', C.white);
  }

  private knife(g: Game) {
    this.knifeT = 16;
    this.knifeAlt = !this.knifeAlt;
    g.snd('slash', this.x, 0.7);
    // damage lands on the swing's impact frame (after a tiny anticipation)
    const f = this.facing;
    g.later(4, () => {
      if (this.state === 'dead') return;
      const box: Rect = { x: f > 0 ? this.x - 4 : this.x - 28, y: this.y - 32, w: 32, h: 32 };
      const n = g.hitArea(box, { dmg: 5, kind: 'knife', x: this.x + f * 14, y: this.y - 18, dx: f, dy: -0.2, force: 2.2, from: 'player' }, (e) => e.meleeable);
      if (n > 0) {
        g.hitstop(5);
        g.shake(2.5);
        g.fx.star(this.x + f * 14, this.y - 18, 9, 3);
        g.snd('hitheavy', this.x, 0.6);
      }
    });
  }

  private throwBomb(g: Game) {
    this.bombs--;
    this.throwT = 18;
    g.snd('throw', this.x, 0.5);
    const f = this.facing;
    const upAim = this.aimAng < -0.3;
    g.later(5, () => {
      if (this.state === 'dead') return;
      const vx = f * (upAim ? 1.6 : 2.7) + this.vx * 0.5;
      const vy = upAim ? -5.2 : -3.4;
      g.add(new Grenade(this.x + f * 2, this.y - 26, vx, vy, 'player'));
    });
  }

  private updateScarf(g: Game) {
    const f = this.facing;
    const low = this.crouch || this.state === 'slide';
    let ax = this.x - f * (2 - Math.round(this.lean * 0.5)), ay = this.y - (low ? (this.state === 'slide' ? 12 : 16) : 23 - (this.landT > 2 ? -2 : 0));
    if (this.state === 'dead') {
      // Follow the neck through the same mirrored rotation and ground offset as the rig.
      const a = this.spin * f, ca = Math.cos(a), sa = Math.sin(a);
      const lie = this.onGround ? Math.round(Math.abs(Math.sin(this.spin)) * 9) : 0;
      ax = this.x - 2 * f * ca + 11 * sa;
      ay = this.y + lie - 12 - 2 * f * sa - 11 * ca;
    }
    if (this.scarf.length === 0) {
      for (let i = 0; i < 6; i++) this.scarf.push({ x: ax - f * i * 2.5, y: ay, px: ax - f * i * 2.5, py: ay });
    }
    const p0 = this.scarf[0];
    p0.x = ax; p0.y = ay; p0.px = ax; p0.py = ay;
    const wind = Math.sin(g.t * 0.15) * 0.08 - f * 0.04;
    for (let i = 1; i < this.scarf.length; i++) {
      const p = this.scarf[i];
      const vx = (p.x - p.px) * 0.86, vy = (p.y - p.py) * 0.86;
      p.px = p.x; p.py = p.y;
      p.x += vx + wind;
      p.y += vy + 0.09;
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < this.scarf.length; i++) {
        const a = this.scarf[i - 1], b = this.scarf[i];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const k = (d - 2.6) / d;
        b.x -= dx * k;
        b.y -= dy * k;
        if (this.state === 'dead') {
          const floor = g.solidAt(b.x, b.y, true);
          if (floor) { b.y = floor.y - 1; b.py = b.y; }
        }
      }
    }
  }

  // ------------------------------------------------------------------ draw
  draw(g: Game, s: Surface) {
    if (this.inv > 0 && this.state !== 'respawn' && (g.t & 2)) return;
    if (this.inv > 0 && this.state === 'respawn' && (g.t & 4)) return;
    // scarf behind the body (world space)
    for (let i = 1; i < this.scarf.length; i++) {
      const a = this.scarf[i - 1], b = this.scarf[i];
      s.othick(a.x, a.y, b.x, b.y, i < 3 ? 2 : 1, i % 2 ? C.scarf : C.scarfSh);
    }
    rig.begin();
    this.pose(g);
    const f = this.facing < 0;
    if (this.state === 'dead') {
      const lie = this.onGround ? Math.abs(Math.sin(this.spin)) * 9 : 0;
      rig.presentRot(s, this.x, this.y + Math.round(lie), -12, this.spin, f);
    } else rig.present(s, this.x, this.y, f);
    this.drawMuzzle(g, s);
  }

  private drawMuzzle(g: Game, s: Surface) {
    if (this.muzzleF <= 0 || this.state === 'dead') return;
    const { dir, muzzle } = this.gunPose();
    const f = this.facing;
    const x = this.x + muzzle.x * f, y = this.y + muzzle.y;
    const dx = dir.x * f, dy = dir.y;
    const px = -dy, py = dx;
    const w = this.weapon;
    const big = w === 'scatter' ? 2.2 : w === 'gat' ? 1.4 : w === 'rocket' ? 1.3 : 1;
    if (w === 'flame') {
      s.disc(x + dx * 2, y + dy * 2, 2.5, C.fire1);
      s.disc(x + dx * 2, y + dy * 2, 1.5, C.white);
      return;
    }
    const k = this.muzzleF / 3;
    const L = (6 + this.muzzleKind * 2) * big * (0.6 + 0.4 * k);
    const Wd = 3 * big * k;
    // outer flame (orange), inner (yellow), core (white)
    s.thick(x, y, x + dx * L, y + dy * L, Math.max(2, Math.round(Wd + 1)), C.fire3);
    s.thick(x + px * Wd, y + py * Wd, x + dx * L * 0.5, y + dy * L * 0.5, 2, C.fire2);
    s.thick(x - px * Wd, y - py * Wd, x + dx * L * 0.5, y + dy * L * 0.5, 2, C.fire2);
    s.thick(x, y, x + dx * L * 0.7, y + dy * L * 0.7, 2, C.fire1);
    s.disc(x + dx, y + dy, 1.5 * big, C.white);
    if (w === 'scatter' && k > 0.6) {
      for (let i = -2; i <= 2; i++) {
        const a = Math.atan2(dy, dx) + i * 0.22;
        s.line(x, y, x + Math.cos(a) * L * 1.3, y + Math.sin(a) * L * 1.3, C.fire1);
      }
    }
  }

  // Assemble the character on the rig (facing right).
  private pose(g: Game) {
    const t = g.t;
    const st = this.state;
    const running = this.onGround && Math.abs(this.vx) > 0.25 && st !== 'slide';
    const air = !this.onGround && st !== 'slide';
    const lean = Math.round(Math.max(-2, Math.min(2.5, this.lean)));
    let hip = v(0, -13);
    let footB = v(-3, 0), footF = v(3, 0);
    let neck = v(1 + lean, -23);
    let headOff = v(0, 0);

    if (st === 'dead') {
      hip = v(0, -13);
      footB = v(-6, -4);
      footF = v(5, -2);
      neck = v(-2, -23);
    } else if (st === 'victory') {
      const k = Math.min(1, this.victoryT / 10);
      const bounce = this.victoryT < 30 ? Math.round(Math.sin(this.victoryT * 0.3) * 1.5) : 0;
      hip = v(0, -13 - bounce);
      footB = v(-5, 0);
      footF = v(5, 0);
      neck = v(0, -23 - bounce - k);
    } else if (st === 'slide') {
      // baseball slide: lead leg straight out, trailing leg folded, torso leaning back
      hip = v(-3, -5);
      footB = v(-2, 0);
      footF = v(10, 0);
      neck = v(-5, -14);
    } else if (this.crouch) {
      hip = v(-1, -8);
      footB = v(-5, 0);
      footF = v(5, 0);
      neck = v(2 + (running ? 1 : 0), -17);
      if (running) {
        const p = Math.floor(this.runPhase * 6) / 6;
        footB = v(-5 + Math.sin(p * Math.PI * 2) * 2, 0);
        footF = v(5 - Math.sin(p * Math.PI * 2) * 2, 0);
      }
    } else if (air) {
      if (this.vy < -1) {
        // take-off / rising: tucked legs
        hip = v(0, -14);
        footB = v(-5, -4);
        footF = v(3, -6);
        neck = v(1 + lean, -24);
      } else if (this.vy < 1.5) {
        hip = v(0, -14);
        footB = v(-4, -3);
        footF = v(4, -5);
        neck = v(1 + lean, -24);
      } else {
        // falling: legs reach for the ground
        hip = v(0, -13);
        footB = v(-3, -1);
        footF = v(4, -2);
        neck = v(1 + lean, -23);
      }
      if (this.aimAng > 0.5) {
        // aiming down: spread legs
        footB = v(-6, -3);
        footF = v(6, -3);
      }
    } else if (running) {
      const p = Math.floor(this.runPhase * 10) / 10;
      const leg = (q: number): V => {
        q = ((q % 1) + 1) % 1;
        if (q < 0.5) return v(6 - 24 * q, 0);
        const k = (q - 0.5) / 0.5;
        return v(-6 + 12 * k, -Math.sin(k * Math.PI) * 5);
      };
      footF = leg(p);
      footB = leg(p + 0.5);
      const bob = Math.cos(p * Math.PI * 4) > 0.3 ? 1 : 0;
      hip = v(1, -13 + bob);
      neck = v(3 + lean, -23 + bob);
      headOff = v(0, bob);
    } else {
      // idle breathing
      const br = Math.sin(t * 0.07) > 0.4 ? 1 : 0;
      neck = v(1 + lean, -23 + br);
      headOff = v(0, br);
    }
    if (this.landT > 0 && !air && st !== 'slide') {
      const k = this.landT > 3 ? 2 : 1;
      hip = v(hip.x, hip.y + k * 2);
      neck = v(neck.x + 1, neck.y + k * 2);
      footB = v(footB.x - 1, footB.y);
      footF = v(footF.x + 1, footF.y);
    }

    const gp = this.gunPose();
    const aimUp = this.aimAng < -0.3;
    if (aimUp && !this.crouch && st === 'play') neck = v(neck.x - 1, neck.y);

    const R = rig;
    const legLen = 6.5;
    const drawLeg = (foot: V, back: boolean) => {
      const ankle = v(foot.x, foot.y - 2);
      const knee = ik(hip, ankle, legLen, legLen, -1);
      R.limb(hip, knee, 4, back ? C.pantsSh : C.pants);
      R.limb(knee, ankle, 3, back ? C.pantsSh : C.pants);
      R.orect(ankle.x - 2, ankle.y, 6, 2, back ? C.bootSh : C.boot);
      R.rect(ankle.x - 2, ankle.y + 1, 6, 1, C.bootSh);
      if (!back) R.px(ankle.x + 2, ankle.y, C.woodHi);
    };

    // hand positions
    const knifing = this.knifeT > 0;
    const throwing = this.throwT > 0;
    let handF = gp.grip;
    let handB = v(gp.grip.x + gp.dir.x * 5, gp.grip.y + gp.dir.y * 5);
    const shF = v(neck.x, neck.y + 2);
    const shB = v(neck.x - 2, neck.y + 2);
    let gunVisible = true;
    let gunLow = false;
    if (knifing || throwing || st === 'victory' || st === 'dead') {
      gunLow = true;
      const k = knifing ? 16 - this.knifeT : 18 - this.throwT;
      if (knifing) {
        // anticipation -> slash -> follow-through
        const arc = this.knifeAlt ? [-2.4, -2.2, -1.6, -0.5, 0.6, 1.0, 1.1, 1.1] : [0.9, 0.8, 0.2, -0.6, -1.4, -1.8, -1.9, -1.9];
        const a = arc[Math.min(arc.length - 1, Math.floor(k / 2))];
        handF = v(shF.x + Math.cos(a) * 9, shF.y + Math.sin(a) * 9);
      } else if (throwing) {
        const arc = [2.6, 2.9, -2.6, -2.0, -1.2, -0.5, 0.2, 0.5, 0.6];
        const a = arc[Math.min(arc.length - 1, Math.floor(k / 2))];
        handF = v(shF.x + Math.cos(a) * 9, shF.y + Math.sin(a) * 9);
      } else if (st === 'victory') {
        handF = v(shF.x + 2, shF.y - 10 - (this.victoryT % 40 < 20 ? 1 : 0));
      } else {
        handF = v(shF.x + 6, shF.y - 6);
      }
      handB = v(shB.x + 3, shB.y + 8);
    }
    if (st === 'dead') handB = v(shB.x - 6, shB.y - 4);

    // --- back arm
    const elbB = ik(shB, handB, 5, 5, 1);
    R.limb(shB, elbB, 3, C.vestSh);
    R.limb(elbB, handB, 3, C.skinSh);
    // --- legs
    drawLeg(footB, true);
    drawLeg(footF, false);
    // --- torso (vest over shirt) with belt
    R.limb(hip, neck, 7, C.vest);
    R.limb(v(hip.x + 1, hip.y - 1), v(neck.x + 1, neck.y + 2), 3, C.vestHi);
    R.bare(v(hip.x - 3, hip.y - 1), v(hip.x + 3, hip.y - 1), 2, C.woodSh);
    R.px(hip.x + 1, hip.y - 1, C.brass);
    // backpack / flamer tank
    if (this.weapon === 'flame') {
      R.orect(neck.x - 7, neck.y + 1, 4, 9, C.red);
      R.rect(neck.x - 6, neck.y + 2, 1, 7, C.fire3);
    } else {
      R.orect(neck.x - 6, neck.y + 2, 3, 7, C.vestSh);
    }
    // --- head
    const head = st === 'dead' ? HEAD_PLAYER_HURT : (this.muzzleF > 0 && this.weapon !== 'pistol') || knifing || throwing || this.landT > 5 ? HEAD_PLAYER_YELL : HEAD_PLAYER;
    R.sprite(head, neck.x - 5 + headOff.x, neck.y - 9 + headOff.y);
    // --- gun
    const drawGun = (grip: V, dir: V) => {
      const perp = v(-dir.y, dir.x);
      const at = (d: number, p = 0) => v(grip.x + dir.x * d + perp.x * p, grip.y + dir.y * d + perp.y * p);
      switch (this.weapon) {
        case 'pistol':
          R.limb(at(-1), at(7), 2, C.gun);
          R.limb(at(0, 1), at(0, 3), 2, C.gunSh);
          R.px(at(5).x, at(5).y, C.gunHi);
          break;
        case 'gat':
          R.limb(at(-4, 1), at(4, 1), 5, C.gunSh);
          R.limb(at(2), at(15), 3, C.gun);
          R.bare(at(4, -1), at(14, -1), 1, C.gunHi);
          R.odisc(at(3, 3).x, at(3, 3).y, 2.5, C.brass);
          R.px(at(3, 3).x - 1, at(3, 3).y - 1, C.fire1);
          R.bare(at(14, -1), at(14, 1), 1, C.gunSh);
          break;
        case 'scatter': {
          const pump = this.pumpT > 0 && this.pumpT < 10 ? -3 : 0;
          R.limb(at(-5, 1), at(1, 1), 3, C.wood);
          R.limb(at(0), at(14), 3, C.gun);
          R.limb(at(5 + pump, 2), at(10 + pump, 2), 2, C.woodSh);
          R.px(at(12).x, at(12).y, C.gunHi);
          break;
        }
        case 'rocket':
          R.limb(at(-6, -1), at(13, -1), 5, C.green);
          R.bare(at(-4, -2), at(10, -2), 1, C.greenSh);
          R.limb(at(2, 2), at(2, 4), 2, C.gunSh);
          R.orect(at(12, -1).x - 1, at(12, -1).y - 2, 2, 4, C.steelSh);
          break;
        case 'flame':
          R.limb(at(-2), at(12), 3, C.steel);
          R.limb(at(9), at(13), 2, C.brass);
          R.px(at(13).x, at(13).y, C.fire1);
          R.limb(at(0, 2), at(0, 4), 2, C.gunSh);
          break;
      }
    };
    if (gunVisible) {
      if (gunLow) drawGun(v(handB.x, handB.y), v(0.94, 0.34));
      else drawGun(gp.grip, gp.dir);
    }
    // --- front arm (over the gun)
    const elbF = ik(shF, handF, 5, 5, knifing || throwing ? -1 : 1);
    R.limb(shF, elbF, 3, C.vest);
    R.limb(elbF, handF, 3, C.skin);
    R.px(Math.round(handF.x), Math.round(handF.y) + 1, C.skinSh);
    if (knifing) {
      const k = 16 - this.knifeT;
      const a = Math.atan2(handF.y - shF.y, handF.x - shF.x);
      R.limb(handF, v(handF.x + Math.cos(a) * 6, handF.y + Math.sin(a) * 6), 1, C.white);
      if (k >= 4 && k <= 9) {
        // swoosh arc (impact frame)
        for (let i = 0; i < 7; i++) {
          const aa = (this.knifeAlt ? -1.6 : 0.9) + (this.knifeAlt ? 1 : -1) * i * 0.4;
          R.px(shF.x + Math.cos(aa) * 14, shF.y + Math.sin(aa) * 14, i > 4 ? C.goggle : C.white);
          R.px(shF.x + Math.cos(aa) * 13, shF.y + Math.sin(aa) * 13, C.goggleHi);
        }
      }
    }
    if (throwing && this.throwT > 12) R.odisc(handF.x, handF.y - 1, 2, C.vest);
  }
}
