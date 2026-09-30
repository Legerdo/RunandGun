import { Surface } from '../engine/surface';
import { C } from './palette';

// Shared attack telegraphs. One visual language for every hazard in the game:
//   ground zone  = "something lands/explodes here"      (pink band + brackets on the floor)
//   lane         = "something sweeps through this height" (translucent band + moving chevrons)
//   aim line     = "a shot will travel along this line"   (dotted, turns solid when locked)
// Blink rates stay at or below ~8 Hz so warnings read as warnings, not as flicker.

const blink = (t: number, fast: boolean) => ((t >> (fast ? 2 : 3)) & 1) === 0;

// k: 0..1 urgency (fills in and blinks faster as the hit approaches)
export function groundZone(s: Surface, cx: number, halfW: number, y: number, t: number, k: number) {
  const x0 = Math.round(cx - halfW), x1 = Math.round(cx + halfW);
  const on = blink(t, k > 0.65);
  s.drect(x0, y - 2, x1 - x0, 3, C.ebul, 0.25 + 0.5 * k);
  const c = on ? C.yellow : C.ebul;
  // corner brackets
  s.rect(x0 - 1, y - 6, 2, 7, C.outline);
  s.rect(x1 - 1, y - 6, 2, 7, C.outline);
  s.rect(x0 - 1, y - 6, 1, 6, c);
  s.rect(x1, y - 6, 1, 6, c);
  s.rect(x0 - 1, y, 4, 1, c);
  s.rect(x1 - 3, y, 4, 1, c);
  // centre tick
  s.rect(Math.round(cx), y - 3 - Math.round(k * 3), 1, 3 + Math.round(k * 3), c);
}

// Horizontal danger lane between y0 and y1, sweeping in direction dir (-1 = to the left).
export function lane(s: Surface, x0: number, x1: number, y0: number, y1: number, t: number, dir: number, k = 0.5) {
  if (x1 < x0) [x0, x1] = [x1, x0];
  const on = blink(t, k > 0.65);
  s.drect(x0, y0, x1 - x0, y1 - y0, C.ebul, on ? 0.34 : 0.2);
  s.rect(x0, y0, x1 - x0, 1, on ? C.yellow : C.ebul);
  s.rect(x0, y1 - 1, x1 - x0, 1, on ? C.yellow : C.ebul);
  // chevrons travelling in the attack direction
  const mid = Math.round((y0 + y1) / 2);
  const h = Math.max(2, Math.min(5, Math.floor((y1 - y0) / 2) - 1));
  const step = 22;
  const off = ((t * 2 * dir) % step + step) % step;
  for (let x = x0 + off; x < x1; x += step) {
    for (let i = 0; i <= h; i++) {
      const px = Math.round(x - dir * i);
      s.pset(px, mid - i, C.white);
      s.pset(px, mid + i, C.white);
    }
  }
}

// Aim line from (x,y) at angle a. locked = the shot is committed to this line.
export function aimLine(s: Surface, x: number, y: number, a: number, len: number, t: number, locked: boolean) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const gap = locked ? 2 : 4;
  for (let i = 10; i < len; i += gap) {
    const px = x + ca * i, py = y + sa * i;
    s.pset(px, py, locked && blink(t, true) ? C.white : C.ebul);
  }
  if (locked) {
    // reticle where the line meets the ground/end
    const ex = x + ca * len, ey = y + sa * len;
    s.ring(ex, ey, 4, blink(t, true) ? C.yellow : C.ebul);
  }
}

// Small "!" alert badge (used when an attack comes from off-screen or from behind).
export function alertBadge(s: Surface, x: number, y: number, t: number) {
  if (!blink(t, true)) return;
  s.odisc(x, y, 5, C.ebul);
  s.rect(x, y - 3, 1, 4, C.white);
  s.pset(x, y + 2, C.white);
}
