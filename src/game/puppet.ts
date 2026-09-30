import { Surface, fromRows, Mode, OUTLINE, type BlitOpts } from '../engine/surface';
import { C } from './palette';

export interface V { x: number; y: number }
export const v = (x: number, y: number): V => ({ x, y });

// Two-bone IK. Returns the middle joint. bend = +1 / -1 chooses the side.
export function ik(a: V, b: V, l1: number, l2: number, bend: number): V {
  let dx = b.x - a.x, dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  const max = l1 + l2 - 0.01;
  if (d > max) {
    dx *= max / d;
    dy *= max / d;
    d = max;
  }
  if (d < 0.001) return v(a.x, a.y + l1);
  const t = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - t * t));
  const ux = dx / d, uy = dy / d;
  return v(a.x + ux * t - uy * h * bend, a.y + uy * t + ux * h * bend);
}

// A scratch canvas where a character is assembled facing right, then presented to the screen.
export class Rig {
  s: Surface;
  ox: number;
  oy: number;
  constructor(w: number, h: number, ox: number, oy: number) {
    this.s = new Surface(w, h);
    this.ox = ox;
    this.oy = oy;
  }
  begin() {
    this.s.clear(0);
  }
  limb(a: V, b: V, t: number, c: number) {
    this.s.othick(this.ox + a.x, this.oy + a.y, this.ox + b.x, this.oy + b.y, t, c);
  }
  bare(a: V, b: V, t: number, c: number) {
    this.s.thick(this.ox + a.x, this.oy + a.y, this.ox + b.x, this.oy + b.y, t, c);
  }
  rect(x: number, y: number, w: number, h: number, c: number) {
    this.s.rect(this.ox + x, this.oy + y, w, h, c);
  }
  orect(x: number, y: number, w: number, h: number, c: number) {
    this.s.orect(this.ox + x, this.oy + y, w, h, c);
  }
  disc(x: number, y: number, r: number, c: number) {
    this.s.disc(this.ox + x, this.oy + y, r, c);
  }
  odisc(x: number, y: number, r: number, c: number) {
    this.s.odisc(this.ox + x, this.oy + y, r, c);
  }
  px(x: number, y: number, c: number) {
    this.s.pset(this.ox + x, this.oy + y, c);
  }
  line(a: V, b: V, c: number) {
    this.s.line(this.ox + a.x, this.oy + a.y, this.ox + b.x, this.oy + b.y, c);
  }
  sprite(spr: Surface, x: number, y: number) {
    this.s.blitOutlined(spr, this.ox + x, this.oy + y);
  }
  // Draw into the screen so that the rig origin lands on world (wx, wy).
  present(dst: Surface, wx: number, wy: number, flip: boolean, o?: BlitOpts) {
    const dx = flip ? wx + this.ox - this.s.w + 1 : wx - this.ox;
    dst.blit(this.s, dx, wy - this.oy, { ...o, flip });
  }
  presentRot(dst: Surface, wx: number, wy: number, pivY: number, ang: number, flip: boolean, o?: BlitOpts) {
    // pivot is (0, pivY) in rig-local coordinates
    dst.blitRot(this.s, this.ox, this.oy + pivY, wx, wy + pivY, flip ? -ang : ang, { ...o, flip });
  }
}

// ------------------------------------------------------------------ heads

const PH = { h: C.hair, H: C.hairHi, s: C.skin, S: C.skinSh, g: C.gunSh, f: C.brass, G: C.goggle, L: C.goggleHi, w: C.offwhite, e: C.black, m: C.redSh };
export const HEAD_PLAYER = fromRows([
  '....hhhhh..',
  '...hhHHHhh.',
  '..hhhhhhhfG',
  'hhhggggggfL',
  'hhhhhhsssss',
  '..hhhssswes',
  '..hhsssssss',
  '...hSsssms.',
  '....SSsss..',
], PH);
export const HEAD_PLAYER_HURT = fromRows([
  '....hhhhh..',
  '...hhHHHhh.',
  '..hhhhhhhfG',
  'hhhggggggfL',
  'hhhhhhsssss',
  '..hhhsssees',
  '..hhsssssss',
  '...hSssmms.',
  '....SSsmm..',
], PH);
export const HEAD_PLAYER_YELL = fromRows([
  '....hhhhh..',
  '...hhHHHhh.',
  '..hhhhhhhfG',
  'hhhggggggfL',
  'hhhhhhsssss',
  '..hhhssswes',
  '..hhsssssss',
  '...hSssmmm.',
  '....SSsmm..',
], PH);

const EH = { c: C.crest, m: C.tin, M: C.tinHi, d: C.tinSh, s: C.eskin, S: C.eskinSh, w: C.offwhite, e: C.black, k: C.woodSh, o: C.redSh, x: C.black };
const TIN_TOP = [
  '.....cc....',
  '...mmmMMm..',
  '..mmmmmMMm.',
  '.mmmmmmmmmm',
  '..ddddddddd',
];
export const HEAD_TIN = fromRows([...TIN_TOP,
  '...Ssssww..',
  '...Ssssweo.',
  '...Sssssss.',
  '...kSsssS..',
  '....kSSs...',
].map((r) => r.replace('o', 's')), EH);
export const HEAD_TIN_SURPRISE = fromRows([...TIN_TOP,
  '...Ssswww..',
  '...Ssswews.',
  '...Ssswwss.',
  '...kSsooS..',
  '....kSoo...',
], EH);
export const HEAD_TIN_HURT = fromRows([...TIN_TOP,
  '...Ssssss..',
  '...Sssseee.',
  '...Sssssss.',
  '...kSsoos..',
  '....kSSs...',
], EH);
export const HEAD_TIN_DEAD = fromRows([...TIN_TOP,
  '...Sssxsx..',
  '...Ssssxss.',
  '...Sssxsxs.',
  '...kSsoos..',
  '....kSSs...',
], EH);
// Bare head (helmet knocked off) for comedic reactions.
export const HEAD_TIN_BALD = fromRows([
  '...........',
  '....SSSs...',
  '...Sssssss.',
  '..Ssssssss.',
  '..Sssssss..',
  '...Ssswww..',
  '...Ssswews.',
  '...Sssssss.',
  '...kSsooS..',
  '....kSoo...',
], EH);
export const HELMET_TIN = fromRows(TIN_TOP, EH);

const RH = { b: C.rusher, B: C.rusherSh, h: C.hair, s: C.eskin, S: C.eskinSh, w: C.offwhite, e: C.black, o: C.redSh, t: C.white };
export const HEAD_RUSHER = fromRows([
  '...........',
  '....hhhh...',
  '..bbbbbbb..',
  'bBbbbbbbbb.',
  '.B.hhsssss.',
  '...hsssswe.',
  '...Sssssss.',
  '...Ssstts..',
  '...SSsooS..',
  '....SSSs...',
], RH);

// Hostage (captured dock worker): knit cap, huge moustache.
const HH = { c: C.teal, C: C.tealSh, s: C.skin, S: C.skinSh, m: C.hair, e: C.black, w: C.offwhite };
export const HEAD_POW = fromRows([
  '...ccccc...',
  '..cccCccc..',
  '.cccccccccc',
  '.CCCCCCCCC.',
  '..Ssssssss.',
  '..Sssssses.',
  '..Sssssssss',
  '..SsmmmmmS.',
  '...Smmmmm..',
  '....SSSS...',
], HH);
export const HEAD_POW_HAPPY = fromRows([
  '...ccccc...',
  '..cccCccc..',
  '.cccccccccc',
  '.CCCCCCCCC.',
  '..Ssssssss.',
  '..Sssssese.',
  '..Sssssssss',
  '..SsmmmmmS.',
  '...Smwwwm..',
  '....SSSS...',
], HH);

// Return a copy with a baked 1px outline (and 1px padding) for sprites drawn via rotation.
export function bake(spr: Surface): Surface {
  const o = new Surface(spr.w + 2, spr.h + 2);
  o.blitOutlined(spr, 1, 1);
  return o;
}

export const flashOpts = (flash: number): BlitOpts | undefined => (flash > 0 ? { mode: Mode.Flash, color: 0xffffffff } : undefined);
export { OUTLINE };
