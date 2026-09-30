import { Surface, Mode } from '../engine/surface';
import { Ent } from './types';
import type { Game } from './world';

// A tumbling sprite fragment (helmets, shields, turret hatches, armor plates).
export class Gib extends Ent {
  spr: Surface;
  rot = 0;
  vr: number;
  life: number;
  bounce: number;
  smoke: boolean;
  flip: boolean;
  constructor(spr: Surface, x: number, y: number, vx: number, vy: number, vr = 0.2, life = 120, o: { bounce?: number; smoke?: boolean; flip?: boolean; z?: number } = {}) {
    super();
    this.spr = spr;
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.vr = vr;
    this.life = life;
    this.bounce = o.bounce ?? 0.35;
    this.smoke = o.smoke ?? false;
    this.flip = o.flip ?? false;
    this.z = o.z ?? 45;
  }
  update(g: Game) {
    this.vy += 0.22;
    this.x += this.vx;
    this.y += this.vy;
    this.rot += this.vr;
    const gy = g.groundAt(this.x, this.y - 8);
    const half = this.spr.h / 2;
    if (this.y + half > gy && this.vy > 0) {
      this.y = gy - half;
      if (this.vy > 1.2) {
        this.vy = -this.vy * this.bounce;
        this.vx *= 0.6;
        this.vr *= 0.5;
        g.snd('clank', this.x, 0.2, 0.7);
        g.fx.dust(this.x, gy, 2);
      } else {
        this.vy = 0;
        this.vx *= 0.85;
        this.vr *= 0.7;
        // settle to the nearest flat orientation
        const tgt = Math.round(this.rot / Math.PI) * Math.PI;
        this.rot += (tgt - this.rot) * 0.3;
      }
    }
    if (this.smoke && this.age % 4 === 0) g.fx.smoke(this.x, this.y, 1, 3, undefined, 0.5);
    if (--this.life <= 0) this.dead = true;
  }
  draw(_g: Game, s: Surface) {
    if (this.life < 30 && (this.life & 2)) return;
    s.blitRot(this.spr, this.spr.w / 2, this.spr.h / 2, this.x, this.y, this.rot, { flip: this.flip, mode: Mode.Normal });
  }
}
