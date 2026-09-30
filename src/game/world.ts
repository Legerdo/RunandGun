import { Surface, rgb } from '../engine/surface';
import { Input } from '../engine/input';
import { audio } from '../engine/audio';
import { FX } from './fx';
import { C } from './palette';
import { Ent, type Hit, type Rect, type Solid, type Team, overlap } from './types';
import { Player } from './player';
import { Stage } from './stage';
import { drawHUD, drawOverlay, type Banner } from './ui';
import { SONGS } from './music';

export const W = 384;
const CAM_MAX_SPEED = 4.5;
const CAM_ACCEL = 0.35;
export const H = 216;

export interface Body {
  x: number; y: number; vx: number; vy: number; w: number; h: number;
  onGround: boolean; dropT: number; wall: number;
}

export type Mode = 'title' | 'play' | 'continue' | 'gameover' | 'clear';

export class Game {
  s: Surface;
  input: Input;
  fx = new FX();
  t = 0;
  ents: Ent[] = [];
  solids: Solid[] = [];
  player!: Player;
  stage!: Stage;
  cam = { x: 0, vx: 0, y: 0, minX: 0, maxX: 99999, minY: 0, maxY: 0, lockL: -1, lockR: -1, look: 0, forward: true, fixed: false, ty: 0 };
  shakeAmp = 0;
  shakeX = 0;
  shakeY = 0;
  kickX = 0;
  kickY = 0;
  hitstopF = 0;
  flashF = 0;
  flashMax = 1;
  flashC = C.white;
  slow = 1;
  slowF = 0;
  slowAcc = 0;
  mode: Mode = 'title';
  modeT = 0;
  score = 0;
  hiscore = 50000;
  lives = 3;
  continues = 0;
  rescued = 0;
  kills = 0;
  shots = 0;
  hits = 0;
  playFrames = 0;
  banners: Banner[] = [];
  god = false;
  paused = false;
  titleSel = 0;
  // world-space tint used for dramatic moments
  darken = 0;
  // diagnostics for balancing (read by the test harness)
  deathLog: { x: number; t: number; area: string; cause: string }[] = [];
  hurtCause = '';

  constructor(s: Surface, input: Input) {
    this.s = s;
    this.input = input;
    this.stage = new Stage();
    try {
      this.hiscore = Math.max(this.hiscore, parseInt(localStorage.getItem('rr_hi') ?? '0') || 0);
    } catch { /* storage unavailable */ }
  }

  // ------------------------------------------------------------ lifecycle
  newGame(section = 0) {
    this.ents = [];
    this.solids = [];
    this.fx.clear();
    this.banners = [];
    this.score = 0;
    this.lives = 3;
    this.continues = 0;
    this.rescued = 0;
    this.kills = 0;
    this.shots = 0;
    this.hits = 0;
    this.playFrames = 0;
    this.darken = 0;
    this.slow = 1;
    this.timers = [];
    this.deathLog = [];
    this.cam = { x: 0, vx: 0, y: 0, minX: 0, maxX: 99999, minY: 0, maxY: 0, lockL: -1, lockR: -1, look: 0, forward: true, fixed: false, ty: 0 };
    this.player = new Player();
    this.stage = new Stage();
    this.stage.build(this, section);
    this.add(this.player);
    this.setMode('play');
  }

  setMode(m: Mode) {
    this.mode = m;
    this.modeT = 0;
  }

  add<T extends Ent>(e: T): T {
    this.ents.push(e);
    return e;
  }

  // Frame-based delayed call (respects hit-stop, pause and slow motion).
  timers: { n: number; fn: () => void }[] = [];
  later(n: number, fn: () => void) {
    this.timers.push({ n, fn });
  }

  // ------------------------------------------------------------ juice
  shake(a: number) {
    this.shakeAmp = Math.min(12, Math.max(this.shakeAmp, a));
  }
  kick(x: number, y: number) {
    this.kickX += x;
    this.kickY += y;
  }
  hitstop(n: number) {
    this.hitstopF = Math.max(this.hitstopF, n);
  }
  private lastFlashT = -999;
  flash(n: number, c = C.white) {
    // limit rapid strobing: short flashes need a gap since the previous one
    if (n <= 3 && this.t - this.lastFlashT < 18) return;
    this.lastFlashT = this.t;
    if (n >= this.flashF) {
      this.flashF = n;
      this.flashMax = n;
      this.flashC = c;
    }
  }
  slowmo(scale: number, frames: number) {
    this.slow = scale;
    this.slowF = frames;
  }

  snd(name: string, x: number, vol = 1, pitch = 1, vary?: number) {
    const cx = this.cam.x + W / 2;
    const d = x - cx;
    const off = Math.max(0, Math.abs(d) - W / 2);
    const att = Math.max(0, 1 - off / 260);
    if (att <= 0.01) return;
    audio.play(name, { vol: vol * att, pan: Math.max(-0.8, Math.min(0.8, d / (W * 0.7))), pitch, vary });
  }

  addScore(n: number, x?: number, y?: number) {
    this.score += n;
    if (x !== undefined && y !== undefined) this.fx.text(x, y, String(n));
  }

  banner(text: string, dur = 120, style: Banner['style'] = 'big', sub?: string) {
    this.banners.push({ text, t: 0, dur, style, sub });
  }

  // ------------------------------------------------------------ geometry
  solid(x: number, y: number, w: number, h: number, oneway = false, tag?: string): Solid {
    const s: Solid = { x, y, w, h, oneway, alive: true, tag };
    this.solids.push(s);
    return s;
  }

  solidAt(x: number, y: number, oneway = false): Solid | null {
    for (const s of this.solids) {
      if (!s.alive || (s.oneway && !oneway)) continue;
      if (x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h) return s;
    }
    return null;
  }

  // top of the first solid at or below fromY in column x (inc. one-way platforms)
  groundAt(x: number, fromY: number): number {
    let best = 99999;
    for (const s of this.solids) {
      if (!s.alive) continue;
      if (x < s.x || x >= s.x + s.w) continue;
      if (s.y >= fromY && s.y < best) best = s.y;
    }
    return best;
  }

  moveBody(b: Body) {
    b.wall = 0;
    // ---- X
    let nx = b.x + b.vx;
    const top = b.y - b.h + 1, bot = b.y - 0.5;
    for (const s of this.solids) {
      if (!s.alive || s.oneway) continue;
      if (bot <= s.y || top >= s.y + s.h) continue;
      const l = nx - b.w / 2, r = nx + b.w / 2;
      if (r <= s.x || l >= s.x + s.w) continue;
      // step up small ledges
      if (b.onGround && s.y >= b.y - 7 && s.y < b.y && !this.blockedAbove(nx, s.y, b)) {
        b.y = s.y;
        continue;
      }
      if (b.vx > 0) { nx = s.x - b.w / 2; b.wall = 1; }
      else if (b.vx < 0) { nx = s.x + s.w + b.w / 2; b.wall = -1; }
      else {
        // pushed inside while stationary: eject toward the nearest side
        nx = nx < s.x + s.w / 2 ? s.x - b.w / 2 : s.x + s.w + b.w / 2;
      }
    }
    if (b.wall !== 0) b.vx = 0;
    b.x = nx;
    // ---- Y
    const wasGround = b.onGround;
    let ny = b.y + b.vy;
    b.onGround = false;
    const l = b.x - b.w / 2 + 0.5, r = b.x + b.w / 2 - 0.5;
    if (b.vy >= 0) {
      let land = 99999;
      for (const s of this.solids) {
        if (!s.alive) continue;
        if (r <= s.x || l >= s.x + s.w) continue;
        if (s.oneway && b.dropT > 0) continue;
        if (s.y >= b.y - 0.01 && s.y <= ny + 0.01 && s.y < land) land = s.y;
      }
      // snap down small steps while walking
      if (land === 99999 && wasGround && b.vy < 2) {
        for (const s of this.solids) {
          if (!s.alive) continue;
          if (r <= s.x || l >= s.x + s.w) continue;
          if (s.oneway && b.dropT > 0) continue;
          if (s.y >= b.y && s.y <= b.y + 6 && s.y < land) land = s.y;
        }
      }
      if (land !== 99999) {
        ny = land;
        b.vy = 0;
        b.onGround = true;
      }
    } else {
      for (const s of this.solids) {
        if (!s.alive || s.oneway) continue;
        if (r <= s.x || l >= s.x + s.w) continue;
        const sb = s.y + s.h;
        if (b.y - b.h >= sb - 0.01 && ny - b.h < sb) {
          ny = sb + b.h;
          b.vy = 0;
        }
      }
    }
    b.y = ny;
    if (b.dropT > 0) b.dropT--;
  }

  private blockedAbove(x: number, y: number, b: Body) {
    const r: Rect = { x: x - b.w / 2, y: y - b.h, w: b.w, h: b.h - 1 };
    for (const s of this.solids) if (s.alive && !s.oneway && overlap(r, s)) return true;
    return false;
  }

  onScreen(x: number, margin = 0) {
    return x > this.cam.x - margin && x < this.cam.x + W + margin;
  }

  // ------------------------------------------------------------ combat helpers
  // Apply a hit to all targetable entities overlapping rect r. Returns number of targets hit.
  hitArea(r: Rect, h: Hit, filter?: (e: Ent) => boolean): number {
    let n = 0;
    for (const e of this.ents) {
      if (e.dead || !e.hittable || e.team === h.from) continue;
      if (filter && !filter(e)) continue;
      const b = e.box();
      if (!b || !overlap(b, r)) continue;
      if (e.onHit(this, h)) n++;
    }
    return n;
  }

  explode(x: number, y: number, radius: number, dmg: number, from: Team, o: { scale?: number; noScorch?: boolean; silent?: boolean; shake?: number } = {}) {
    const scale = o.scale ?? radius / 16;
    this.fx.boom(x, y, scale);
    this.fx.light(x, y, radius * 2.6, [190, 120, 50], 10 + scale * 5);
    this.fx.sparks(x, y, 6 + scale * 6, -Math.PI / 2, Math.PI, 4 * scale + 2, C.fire1);
    this.fx.debris(x, y, 4 + scale * 3, C.stoneDk, 2.5 * scale, 4 * scale);
    this.fx.embers(x, y, 5 + scale * 4, radius * 0.6);
    if (scale >= 1.2) this.fx.ring(x, y, radius * 0.3, radius * 1.4, 10);
    if (scale > 0.6) this.fx.star(x, y, radius * 0.9, 3);
    const gy = this.groundAt(x, y - 4);
    if (!o.noScorch && gy - y < radius * 0.8 && gy < 9999) {
      this.fx.decals.push({ x, y: gy + 1, kind: 'scorch', r: radius * 0.8, seed: Math.random() * 1000 });
      this.fx.dust(x, gy, 4 + scale * 3, 0, C.smoke0);
    }
    if (!o.silent) this.snd(scale >= 2.2 ? 'expl_l' : scale >= 1.2 ? 'expl_m' : 'expl_s', x, 0.9);
    this.stage.onExplosion(this, x, y, radius);
    this.shake(o.shake ?? Math.min(10, 1.5 + scale * 2.2));
    if (scale >= 2) this.flash(2, rgb(255, 240, 200));
    if (dmg > 0) {
      for (const e of this.ents) {
        if (e.dead || !e.hittable || e.team === from) continue;
        const b = e.box();
        if (!b) continue;
        const ex = Math.max(b.x, Math.min(x, b.x + b.w));
        const ey = Math.max(b.y, Math.min(y, b.y + b.h));
        const d = Math.hypot(ex - x, ey - y);
        if (d > radius) continue;
        const k = 1 - (d / radius) * 0.5;
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
        const n = Math.hypot(cx - x, cy - y) || 1;
        e.onHit(this, { dmg: dmg * k, kind: 'explosion', x: ex, y: ey, dx: (cx - x) / n, dy: (cy - y) / n - 0.4, force: 3 * k * Math.max(1, scale), from });
      }
      if (from !== 'player') {
        const p = this.player;
        const pb = p.box();
        if (pb) {
          const ex = Math.max(pb.x, Math.min(x, pb.x + pb.w));
          const ey = Math.max(pb.y, Math.min(y, pb.y + pb.h));
          if (Math.hypot(ex - x, ey - y) < radius * 0.75) p.hurt(this, x);
        }
      }
    }
  }

  countTag(tag: string) {
    let n = 0;
    const c = this.cam;
    for (const e of this.ents) {
      if (e.dead || e.tag !== tag || !e.counts) continue;
      // safety net: stragglers far outside a locked arena can't hold the lock forever
      if (c.lockL >= 0 && (e.x < c.lockL - 60 || e.x > c.lockR + 60) && e.age > 600) continue;
      n++;
    }
    return n;
  }

  // ------------------------------------------------------------ main step
  update() {
    const inp = this.input;
    inp.poll();
    this.t++;
    this.modeT++;
    audio.update();

    if (this.mode === 'title') {
      if (inp.pressed('start') || inp.pressed('fire') || inp.pressed('jump')) {
        audio.play('select');
        this.newGame(0);
      }
      return;
    }
    if (this.mode === 'play' && inp.pressed('start')) {
      this.paused = !this.paused;
      audio.play('blip');
    }
    if (this.paused) return;

    // juice timers run even during hit-stop
    if (this.flashF > 0) this.flashF--;
    this.shakeAmp *= 0.86;
    if (this.shakeAmp < 0.3) this.shakeAmp = 0;
    this.shakeX = Math.round((Math.random() * 2 - 1) * this.shakeAmp);
    this.shakeY = Math.round((Math.random() * 2 - 1) * this.shakeAmp * 0.7);
    this.kickX *= 0.7;
    this.kickY *= 0.7;
    for (const b of this.banners) b.t++;
    this.banners = this.banners.filter((b) => b.t < b.dur);

    if (this.hitstopF > 0) {
      this.hitstopF--;
      return;
    }
    if (this.slowF > 0) {
      this.slowF--;
      if (this.slowF === 0) this.slow = 1;
      this.slowAcc += this.slow;
      if (this.slowAcc < 1) return;
      this.slowAcc -= 1;
    }
    this.step();
  }

  private step() {
    if (this.mode === 'play' || this.mode === 'clear') this.playFrames++;
    if (this.mode === 'continue') {
      if (this.input.pressed('start') || this.input.pressed('fire') || this.input.pressed('jump')) {
        this.continues++;
        this.lives = 3;
        audio.play('select');
        this.player.respawn(this);
        this.setMode('play');
      } else if (this.modeT > 60 * 10) {
        this.setMode('gameover');
        audio.playSong(SONGS.gameover);
        audio.voice('gameover', { priority: true });
      }
    }
    if (this.mode === 'gameover') {
      if (this.modeT > 90 && (this.input.pressed('start') || this.input.pressed('fire'))) {
        this.setMode('title');
        audio.playSong(SONGS.title);
      }
      return;
    }

    if (this.timers.length) {
      const due = this.timers.filter((t) => --t.n <= 0);
      this.timers = this.timers.filter((t) => t.n > 0);
      for (const t of due) t.fn();
    }
    this.stage.update(this);
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i];
      if (e.dead) continue;
      e.age++;
      if (e.flash > 0) e.flash--;
      this.hurtCause = e.constructor.name;
      e.update(this);
    }
    this.hurtCause = 'explosion/other';
    this.ents = this.ents.filter((e) => !e.dead);
    this.fx.update(this);
    this.updateCamera();

    if (this.mode === 'clear' && this.modeT > 60 * 12 && (this.input.pressed('start') || this.input.pressed('fire'))) {
      this.setMode('title');
      audio.playSong(SONGS.title);
    }
  }

  // Camera follow. Arena locks and releases only change the *target*; the camera itself moves
  // with a capped speed and acceleration, so it pans into an arena instead of snapping to it.
  updateCamera() {
    const c = this.cam;
    const p = this.player;
    if (c.fixed) return;
    const lookT = p.facing * 34 + p.vx * 8;
    c.look += (lookT - c.look) * 0.05;
    let tx = p.x - W / 2 + c.look;
    if (c.lockL >= 0) tx = Math.max(c.lockL, Math.min(c.lockR - W, tx));
    if (c.forward) tx = Math.max(tx, c.minX);
    tx = Math.max(0, Math.min(c.maxX - W, tx));
    const want = Math.max(-CAM_MAX_SPEED, Math.min(CAM_MAX_SPEED, (tx - c.x) * 0.14));
    c.vx += Math.max(-CAM_ACCEL, Math.min(CAM_ACCEL, want - c.vx));
    c.x += c.vx;
    // Finish the pan exactly so camera-edge stage events cannot miss an asymptotic target.
    if (Math.abs(tx - c.x) < 0.01 && Math.abs(c.vx) < 0.01) { c.x = tx; c.vx = 0; }
    if (c.forward && c.x < c.minX) {
      c.x = c.minX;
      c.vx = Math.max(0, c.vx);
    }
    if (c.forward) c.minX = Math.max(c.minX, c.x);
    const ty = Math.max(c.minY, Math.min(c.maxY, c.ty));
    c.y += (ty - c.y) * 0.08;
  }

  // Place the camera instantly (only used behind a fade or at the start of a section).
  cutCamera(x: number) {
    this.cam.x = x;
    this.cam.vx = 0;
    this.cam.minX = x;
  }

  // ------------------------------------------------------------ render
  render() {
    const s = this.s;
    s.ox = 0;
    s.oy = 0;
    if (this.mode === 'title') {
      drawOverlay(this, s);
      return;
    }
    const cx = Math.round(this.cam.x + this.shakeX + this.kickX);
    const cy = Math.round(this.cam.y + this.shakeY + this.kickY);
    this.stage.drawBack(this, s, cx, cy);
    s.ox = cx;
    s.oy = cy;
    this.stage.drawWorld(this, s);
    this.fx.drawDecals(s);
    const sorted = this.ents.slice().sort((a, b) => a.z - b.z);
    for (const e of sorted) if (e.z < 50) e.draw(this, s);
    this.fx.draw(s, false);
    this.fx.drawBooms(s);
    for (const e of sorted) if (e.z >= 50) e.draw(this, s);
    this.fx.drawLights(s);
    this.fx.draw(s, true);
    this.stage.drawFront(this, s);
    s.ox = 0;
    s.oy = 0;
    if (this.darken > 0) s.brect(0, 0, W, H, C.black, this.darken);
    if (this.flashF > 0) s.brect(0, 0, W, H, this.flashC, Math.min(0.6, (this.flashF / this.flashMax) * 0.6));
    drawHUD(this, s);
    drawOverlay(this, s);
  }
}
