import { Surface, mix } from '../engine/surface';
import { drawText, textWidth } from '../engine/font';
import { C } from './palette';
import { WEAPONS } from './weapons';
import { HEAD_PLAYER, HEAD_POW } from './puppet';
import type { Game } from './world';
import { W, H } from './world';

export interface Banner {
  text: string;
  sub?: string;
  t: number;
  dur: number;
  style: 'big' | 'go' | 'warn' | 'small' | 'mission';
}

export interface BossBar { name: string; frac: number }

const pad = (n: number, w: number) => String(Math.max(0, Math.floor(n))).padStart(w, '0');

export function drawHUD(g: Game, s: Surface) {
  if (g.mode === 'title') return;
  const p = g.player;
  // score
  drawText(s, '1UP', 6, 5, C.white);
  drawText(s, pad(g.score, 8), 28, 5, C.hud);
  // weapon / ammo / bombs panel
  s.brect(5, 15, 110, 20, C.black, 0.45);
  s.orect(5, 15, 110, 20, C.black);
  s.brect(6, 16, 108, 18, C.black, 0.25);
  drawText(s, 'ARMS', 9, 18, C.hudSh, { outline: null });
  drawText(s, 'BOMB', 70, 18, C.hudSh, { outline: null });
  const ammo = p.weapon === 'pistol' ? '~' : String(p.ammo);
  drawText(s, ammo, 9, 26, p.weapon === 'pistol' ? C.white : WEAPONS[p.weapon].color, { outline: null });
  if (p.weapon !== 'pistol') drawText(s, WEAPONS[p.weapon].letter, 50, 26, WEAPONS[p.weapon].color, { outline: null });
  drawText(s, String(p.bombs), 70, 26, p.bombs > 0 ? C.white : C.red, { outline: null });
  // lives
  s.blitOutlined(HEAD_PLAYER, 8, 38);
  drawText(s, '=' + Math.max(0, g.lives), 21, 40, C.white);
  // hi score
  drawText(s, 'HI ' + pad(Math.max(g.hiscore, g.score), 8), W / 2, 5, C.white, { align: 'center' });
  // rescued POWs (top-right)
  const n = Math.min(10, g.rescued);
  for (let i = 0; i < n; i++) s.blitOutlined(HEAD_POW, W - 16 - i * 12, 5);
  if (g.rescued > 0) drawText(s, 'POW', W - 20, 17, C.white, { align: 'right' });

  // boss bar
  const bb = g.stage.bossBar();
  if (bb) {
    const bw = 200, bx = Math.floor((W - bw) / 2), by = H - 14;
    s.orect(bx, by, bw, 6, C.black);
    const f = Math.max(0, Math.min(1, bb.frac));
    s.rect(bx, by, Math.round(bw * f), 6, f > 0.5 ? C.fire2 : f > 0.25 ? C.fire3 : C.red);
    s.rect(bx, by, Math.round(bw * f), 1, C.fire1);
    drawText(s, bb.name, W / 2, by - 10, C.white, { align: 'center' });
  }
}

export function drawOverlay(g: Game, s: Surface) {
  if (g.mode === 'title') return drawTitle(g, s);
  // banners
  for (const b of g.banners) drawBanner(g, s, b);
  if (g.paused) {
    s.brect(0, 0, W, H, C.black, 0.5);
    drawText(s, 'PAUSE', W / 2, 90, C.white, { align: 'center', scale: 2 });
    drawText(s, 'PRESS ENTER TO RESUME', W / 2, 118, C.hud, { align: 'center' });
  }
  if (g.mode === 'continue') {
    s.brect(0, 0, W, H, C.black, 0.55);
    const left = 9 - Math.floor(g.modeT / 60);
    drawText(s, 'CONTINUE?', W / 2, 70, C.white, { align: 'center', scale: 2 });
    drawText(s, String(Math.max(0, left)), W / 2, 96, (g.t >> 3) & 1 ? C.hud : C.fire3, { align: 'center', scale: 4 });
    drawText(s, 'PRESS FIRE', W / 2, 140, C.white, { align: 'center' });
  }
  if (g.mode === 'gameover') {
    s.brect(0, 0, W, H, C.black, Math.min(0.8, g.modeT / 60));
    drawText(s, 'GAME OVER', W / 2, 92, C.red, { align: 'center', scale: 3 });
  }
  if (g.mode === 'clear') drawResults(g, s);
}

function drawBanner(g: Game, s: Surface, b: Banner) {
  const t = b.t;
  const out = b.dur - t;
  if (b.style === 'mission' || b.style === 'big') {
    // slam-in with overshoot, hold, slide out
    const k = Math.min(1, t / 10);
    const ease = 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.15;
    const x = W / 2 + (1 - ease) * 300 - (out < 14 ? (14 - out) * 30 : 0);
    const y = b.style === 'mission' ? 70 : 84;
    if (b.style === 'mission') s.brect(0, y - 8, W, 58, C.black, 0.35);
    drawText(s, b.text, x, y, C.hud, { align: 'center', scale: 3, bottom: C.fire3, shadow: C.black, wave: (i) => (t < 30 ? Math.sin(t * 0.5 + i) * 2 : 0) });
    if (b.sub) drawText(s, b.sub, x, y + 30, C.white, { align: 'center', scale: 1 });
  } else if (b.style === 'go') {
    if ((t >> 3) & 1) {
      drawText(s, 'GO', W - 44, 90, C.hud, { scale: 2, bottom: C.fire3 });
      const ax = W - 20 + ((t >> 2) & 3);
      for (let i = 0; i < 6; i++) s.rect(ax - 6 + i, 92 + i, 2, 12 - i * 2, C.hud);
    }
  } else if (b.style === 'warn') {
    const on = (t >> 3) & 1;
    s.brect(0, 76, W, 44, C.red, on ? 0.35 : 0.15);
    for (let x = -40 + (t % 20); x < W + 40; x += 20) {
      s.thick(x, 78, x + 8, 78, 2, C.yellow);
      s.thick(x + 10, 117, x + 18, 117, 2, C.yellow);
    }
    if (on || t > b.dur - 30) drawText(s, b.text, W / 2, 88, C.white, { align: 'center', scale: 3, bottom: C.fire1 });
    if (b.sub) drawText(s, b.sub, W / 2, 110, C.white, { align: 'center' });
  } else {
    drawText(s, b.text, W / 2, 50, C.white, { align: 'center', scale: 2 });
    if (b.sub) drawText(s, b.sub, W / 2, 70, C.hud, { align: 'center' });
  }
}

function drawResults(g: Game, s: Surface) {
  const t = g.modeT;
  if (t < 120) return;
  const k = Math.min(1, (t - 120) / 30);
  s.brect(0, 0, W, H, C.black, 0.6 * k);
  if (t < 140) return;
  drawText(s, 'MISSION COMPLETE!', W / 2, 26, C.hud, { align: 'center', scale: 2, bottom: C.fire3 });
  const acc = g.shots > 0 ? Math.min(100, Math.round((g.hits / g.shots) * 100)) : 0;
  const secs = Math.floor(g.playFrames / 60);
  const rows: [string, string][] = [
    ['SCORE', pad(g.score, 8)],
    ['POWS RESCUED', String(g.rescued)],
    ['ENEMIES DOWN', String(g.kills)],
    ['ACCURACY', acc + '%'],
    ['TIME', `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`],
    ['CONTINUES', String(g.continues)],
  ];
  rows.forEach(([a, b], i) => {
    if (t < 160 + i * 18) return;
    drawText(s, a, 96, 60 + i * 14, C.white);
    drawText(s, b, 288, 60 + i * 14, C.hud, { align: 'right' });
  });
  if (t > 160 + rows.length * 18 + 20) {
    const rank = g.continues === 0 && acc > 40 ? 'S' : g.continues === 0 ? 'A' : g.continues < 3 ? 'B' : 'C';
    drawText(s, 'RANK', 150, 150, C.white, { scale: 2 });
    drawText(s, rank, 214, 144, rank === 'S' ? C.fire1 : C.hud, { scale: 4, bottom: C.fire3 });
  }
  if (t > 60 * 12 && ((t >> 4) & 1)) drawText(s, 'PRESS START', W / 2, 196, C.white, { align: 'center' });
}

function drawTitle(g: Game, s: Surface) {
  g.stage.drawTitleBack(g, s);
  const t = g.t;
  // logo
  const y = 30;
  const bob = Math.round(Math.sin(t * 0.05) * 2);
  drawText(s, 'RIVET', W / 2, y + bob, C.hud, { align: 'center', scale: 5, bottom: C.fire3, shadow: C.black, spacing: 1 });
  drawText(s, 'RIOT', W / 2, y + 40 + bob, C.fire2, { align: 'center', scale: 5, bottom: C.red, shadow: C.black, spacing: 1 });
  const sub = 'OPERATION SALTBONE';
  s.brect(W / 2 - textWidth(sub) / 2 - 6, y + 82, textWidth(sub) + 12, 11, C.black, 0.6);
  drawText(s, sub, W / 2, y + 84, C.white, { align: 'center', outline: null });
  if ((t >> 4) & 1) drawText(s, 'PRESS START', W / 2, 150, C.white, { align: 'center', scale: 2 });
  const hint = 'ARROWS/WASD MOVE  Z/J FIRE  X/K JUMP  C/L BOMB  SHIFT SLIDE';
  s.brect(0, H - 22, W, 22, C.black, 0.55);
  drawText(s, hint, W / 2, H - 17, mix(C.white, C.hud, 0.3), { align: 'center', outline: null });
  drawText(s, 'ORIGINAL GAME 2026', W / 2, H - 8, C.stoneSh, { align: 'center', outline: null });
}
