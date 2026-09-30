import { Surface } from './engine/surface';
import { Input, type Action } from './engine/input';
import { audio } from './engine/audio';
import { loadSurface } from './engine/assets';
import { Game, W, H } from './game/world';
import { SONGS } from './game/music';

const VOICES = [
  'mission_start', 'mission_complete', 'w_gatling', 'w_scatter', 'w_rocket', 'w_flame', 'bombs', 'thanks',
  'warning', 'continue', 'gameover', 'hero_die', 'hero_train', 'hero_win', 'tank',
  'boss_intro', 'boss_hurt', 'boss_rage', 'boss_die', 'enemy_die_1', 'enemy_die_2', 'enemy_die_3',
];

const params = new URLSearchParams(location.search);
const testMode = params.has('test');

const canvas = document.getElementById('screen') as HTMLCanvasElement;
canvas.width = W;
canvas.height = H;
const ctx = canvas.getContext('2d')!;
const img = ctx.createImageData(W, H);
const screen = new Surface(W, H, new Uint32Array(img.data.buffer));
const input = new Input();
const game = new Game(screen, input);
if (params.has('god')) game.god = true;
if (params.has('mute')) audio.enabled = false;

function fit() {
  const s = Math.min(window.innerWidth / W, window.innerHeight / H);
  const k = s >= 1 ? Math.max(1, Math.floor(s)) : s;
  canvas.style.width = `${Math.floor(W * k)}px`;
  canvas.style.height = `${Math.floor(H * k)}px`;
}
window.addEventListener('resize', fit);
fit();

let voicesLoaded = false;
function startAudio() {
  audio.init();
  if (!voicesLoaded) {
    voicesLoaded = true;
    audio.loadVoices(VOICES, `${import.meta.env.BASE_URL}voice/`);
  }
  if (game.mode === 'title') audio.playSong(SONGS.title);
}
input.onFirstGesture = startAudio;

// performance stats
const perf = { upd: 0, ren: 0, frames: 0, worst: 0 };

function frame() {
  const t0 = performance.now();
  game.update();
  const t1 = performance.now();
  game.render();
  ctx.putImageData(img, 0, 0);
  const t2 = performance.now();
  perf.upd += t1 - t0;
  perf.ren += t2 - t1;
  perf.frames++;
  perf.worst = Math.max(perf.worst, t2 - t0);
}

// fixed 60 Hz simulation, decoupled from display refresh
let acc = 0;
let last = performance.now();
function loop(now: number) {
  acc += Math.min(100, now - last);
  last = now;
  let n = 0;
  while (acc >= 1000 / 60 && n < 4) {
    const t0 = performance.now();
    game.update();
    perf.upd += performance.now() - t0;
    acc -= 1000 / 60;
    n++;
  }
  if (n > 0) {
    const t1 = performance.now();
    game.render();
    ctx.putImageData(img, 0, 0);
    perf.ren += performance.now() - t1;
    perf.frames++;
  }
  requestAnimationFrame(loop);
}

async function boot() {
  await Promise.all([
    loadSurface('bg_beach', `${import.meta.env.BASE_URL}bg/bg_beach.png`),
    loadSurface('bg_town', `${import.meta.env.BASE_URL}bg/bg_town.png`),
    loadSurface('bg_rail', `${import.meta.env.BASE_URL}bg/bg_rail.png`),
    loadSurface('bg_docks', `${import.meta.env.BASE_URL}bg/bg_docks.png`),
  ]);
  const sec = params.get('section');
  if (sec !== null) game.newGame(parseInt(sec) || 0);
  if (!testMode) requestAnimationFrame(loop);
  else game.render(), ctx.putImageData(img, 0, 0);
}
boot();

// ------------------------------------------------------------------ test harness
declare global {
  interface Window { __rr: unknown }
}
window.__rr = {
  game,
  // advance n fixed frames with an optional held-input set
  step(n: number, held?: Partial<Record<Action, boolean>>) {
    if (held) input.virtual = held;
    for (let i = 0; i < n; i++) frame();
  },
  release() { input.virtual = {}; },
  start(section = 0) { game.newGame(section); frame(); },
  perf() { const r = { upd: perf.upd / Math.max(1, perf.frames), ren: perf.ren / Math.max(1, perf.frames), worst: perf.worst, frames: perf.frames }; perf.upd = perf.ren = perf.frames = perf.worst = 0; return r; },
  state() {
    const p = game.player;
    return {
      mode: game.mode, t: game.t, camX: Math.round(game.cam.x), px: p ? Math.round(p.x) : 0, py: p ? Math.round(p.y) : 0, pstate: p?.state, weapon: p?.weapon, ammo: p?.ammo, bombs: p?.bombs,
      lives: game.lives, score: game.score, ents: game.ents.length, particles: game.fx.ps.length, area: game.stage?.area, arena: !!game.stage?.arena,
      enemies: game.ents.filter((e) => e.team === 'enemy' && e.hittable).length, rescued: game.rescued, kills: game.kills,
      boss: game.stage?.bossBar() ?? null, rail: game.stage?.rail ? { ...game.stage.rail } : null,
    };
  },
  audio,
  initAudio: startAudio,
};
