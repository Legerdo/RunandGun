// Scripted play sessions. Each receives the harness `H`.

export async function smoke(H) {
  await H.shot('00_title');
  await H.start(0);
  await H.step(60);
  await H.shot('01_start');
  H.log(await H.state());
  await H.sheet('02_run_right', 9, 6, { right: true }, 3);
  H.log(await H.state());
  await H.step(30, { right: true, fire: true });
  await H.shot('03_fire');
  H.log(await H.state(), await H.perf());
}

// Close-up animation review of the hero.
export async function anim(H) {
  await H.start(0);
  await H.step(200);
  await H.zsheet('a_idle', 4, 12, {});
  await H.zsheet('a_run', 12, 2, { right: true });
  await H.zsheet('a_stop', 4, 3, {});
  await H.zsheet('a_jump', 12, 4, (i) => (i < 6 ? { jump: true, right: true } : { right: true }));
  await H.step(30);
  await H.zsheet('a_fire', 8, 2, (i) => (i % 2 ? {} : { fire: true }));
  await H.zsheet('a_aimup', 4, 3, { up: true, fire: true });
  await H.zsheet('a_crouch', 4, 3, { down: true, fire: true });
  await H.zsheet('a_slide', 8, 3, (i) => (i === 0 ? { slide: true, right: true } : { right: true }));
  await H.zsheet('a_throw', 8, 2, (i) => (i === 0 ? { bomb: true } : {}));
}

// First encounter: campfire soldiers react, get shot, die.
export async function combat1(H) {
  await H.start(0);
  await H.step(140);
  await H.step(40, { right: true });
  const tgt = '({x: 300, y: 168})';
  await H.zsheet('c_alert', 8, 3, { right: true }, { target: tgt, w: 128, h: 64, scale: 3, cols: 4 });
  await H.zsheet('c_shoot', 12, 3, (i) => (i % 2 ? { fire: true } : {}), { target: tgt, w: 128, h: 64, scale: 3, cols: 4 });
  await H.zsheet('c_after', 8, 6, (i) => (i % 2 ? { fire: true } : {}), { target: tgt, w: 128, h: 64, scale: 3, cols: 4 });
  H.log(await H.state());
  await H.shot('c_wide');
}

// Explosions & destruction: grenade the sandbag line, chain barrels.
export async function boom(H) {
  await H.start(0);
  await H.step(140);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 520; g.cam.x = 380; g.cam.minX = 380; });
  await H.step(10);
  await H.zsheet('b_nade', 12, 4, (i) => (i === 0 || i === 4 ? { bomb: true } : {}), { target: '({x: 600, y: 160})', w: 160, h: 90, scale: 2, cols: 3 });
  await H.eval(() => { const g = window.__rr.game; g.player.x = 780; g.cam.x = 640; g.cam.minX = 640; });
  await H.step(20);
  await H.zsheet('b_barrel', 12, 3, { fire: true }, { target: '({x: 850, y: 150})', w: 160, h: 90, scale: 2, cols: 3 });
  H.log(await H.state(), await H.perf());
}

// ------------------------------------------------------------------ autoplay bot
// A simple in-page pilot: pushes right, faces & aims at the nearest threat, tap-fires,
// lobs bombs, hops obstacles and incoming fire. Used with --god to verify stage flow.
const BOT = `(() => {
  const g = window.__rr.game;
  const p = g.player;
  const h = { right: true };
  if (g.mode !== 'play') return { fire: g.t % 20 < 10, start: false };
  let best = null, bd = 1e9;
  for (const e of g.ents) {
    if (e.dead || !e.hittable || e.team !== 'enemy') continue;
    const b = e.box(); if (!b) continue;
    const ex = b.x + b.w / 2, ey = b.y + b.h / 2;
    if (ex < g.cam.x - 4 || ex > g.cam.x + 390) continue;
    const d = Math.abs(ex - p.x) + Math.abs(ey - p.y) * 0.4;
    if (d < bd) { bd = d; best = { ex, ey, b }; }
  }
  const boss = g.ents.find((e) => e.constructor.name === 'Boss' && e.hittable);
  if (boss && boss.clawAttached) best = { ex: boss.wrist.x - 16, ey: boss.wrist.y, b: { h: 20 } };
  if (best) {
    const dx = best.ex - p.x, dy = best.ey - (p.y - 18);
    if (dx < -6) { h.right = false; h.left = true; }
    else if (dx < 70) { h.right = p.facing < 0; if (dx < 30 && g.t % 60 < 30) h.left = true; }
    if (dy < -28) { h.up = true; if (Math.abs(dx) > 40 && dx > 0) h.right = true; }
    if (best.b.h > 60 && g.t % 240 < 120) h.up = true;
  }
  h.fire = g.t % 4 < 2;
  if (g.t % 70 === 0 && p.bombs > 3) h.bomb = true;
  // hop incoming low threats
  for (const e of g.ents) {
    if (e.team !== 'enemy' || e.dead) continue;
    const n = e.constructor.name;
    if ((n === 'EBullet' || n === 'GroundWave' || n === 'Grenade') && Math.abs(e.x - p.x) < 40 && Math.abs(e.y - p.y) < 30) h.jump = true;
  }
  if (g.t % 45 === 0 || p.wall) h.jump = true;
  if (g.t % 120 === 60 && !best) h.slide = true;
  return h;
})()`;

export async function runbot(H, frames = 60 * 60 * 9, every = 300, prefix = 'r', requireClear = false) {
  let n = 0;
  let lastArea = '';
  let stuck = 0, lastKey = '', cleared = false;
  while (n < frames) {
    const res = await H.eval(([k, src]) => {
      const rr = window.__rr;
      for (let i = 0; i < k; i++) {
        const held = eval(src);
        rr.step(1, held);
        if (rr.game.mode === 'clear' && rr.game.modeT > 700) return 'clear';
      }
      return rr.game.mode === 'clear' ? 'clearing' : rr.game.mode;
    }, [every, BOT]);
    n += every;
    const st = await H.state();
    const tag = `${prefix}_${String(Math.floor(n / every)).padStart(3, '0')}`;
    if (st.area !== lastArea || n % (every * 4) === 0 || st.boss) await H.shot(tag, 1);
    lastArea = st.area;
    H.log(tag, JSON.stringify({ mode: st.mode, area: st.area, camX: st.camX, px: st.px, py: st.py, w: st.weapon, a: st.ammo, b: st.bombs, lives: st.lives, score: st.score, ents: st.ents, fx: st.particles, arena: st.arena, en: st.enemies, boss: st.boss, rail: st.rail?.on ? st.rail.phase + ':' + st.rail.t : '', kills: st.kills, pow: st.rescued }));
    if (res === 'clear') { cleared = true; H.log('MISSION CLEAR reached at frame', n); await H.shot(prefix + '_results', 2); break; }
    const key = st.camX + ':' + st.enemies + ':' + (st.rail?.t ?? 0) + ':' + JSON.stringify(st.boss);
    stuck = key === lastKey ? stuck + 1 : 0;
    lastKey = key;
    if (stuck === 6) {
      H.log('STUCK?', await H.eval(() => window.__rr.game.ents.filter((e) => e.team === 'enemy' || e.counts).map((e) => `${e.constructor.name}@${Math.round(e.x)},${Math.round(e.y)} hp=${e.hp} st=${e.state ?? ''} hit=${e.hittable} counts=${e.counts} tag=${e.tag} box=${JSON.stringify(e.box?.())}`)));
      H.log('STUCK trace', await H.eval((src) => {
        const g = window.__rr.game;
        const log = [];
        for (const e of g.ents) {
          if (!e.hittable) continue;
          const f = e.onHit.bind(e);
          e.onHit = (gg, h) => { const m = f(gg, h); log.push(`${e.constructor.name}@${Math.round(e.x)} ${h.kind} ${Math.round(h.x)},${Math.round(h.y)} -> ${m}`); return m; };
        }
        const p = g.player;
        const seen = new Map(); const deaths = [];
        let shots = g.shots;
        for (let i = 0; i < 90; i++) {
          window.__rr.step(1, eval(src));
          for (const e of g.ents) if (e.team === 'player' && e !== p && 'dmg' in e) seen.set(e, `${Math.round(e.x)},${Math.round(e.y)}`);
          for (const [e, pos] of seen) if (e.dead) { deaths.push(pos); seen.delete(e); }
        }
        return { p: `${Math.round(p.x)},${Math.round(p.y)} f=${p.facing} st=${p.state} w=${p.weapon}`, shots: g.shots - shots, hits: log.slice(0, 8), deaths: deaths.slice(0, 12) };
      }, BOT));
      await H.shot(tag + '_stuck', 2);
      if (requireClear) throw new Error('Full playthrough stalled before mission clear');
      break;
    }
  }
  H.log('perf', await H.perf());
  if (requireClear && !cleared) throw new Error('Full playthrough did not reach mission clear within the frame budget');
}

export async function full(H) {
  await H.start(0);
  await runbot(H, 60 * 60 * 9, 300, 'r', true);
}
export async function fromTown(H) { await H.start(1); await runbot(H, 60 * 60 * 5, 300, 't'); }
export async function fromRail(H) { await H.start(2); await runbot(H, 60 * 60 * 4, 300, 'rl'); }
export async function fromDocks(H) { await H.start(3); await runbot(H, 60 * 60 * 4, 240, 'd'); }

async function botFrames(H, n) {
  await H.eval(([k, src]) => { const rr = window.__rr; for (let i = 0; i < k; i++) rr.step(1, eval(src)); }, [n, BOT]);
}
// Visual check of later sections.
export async function sections(H) {
  await H.start(2);
  await botFrames(H, 300); await H.shot('s_rail1', 2);
  await botFrames(H, 700); await H.shot('s_rail2', 2);
  await H.start(3);
  await botFrames(H, 200); await H.shot('s_docks1', 2);
  await botFrames(H, 700); await H.shot('s_boss1', 2);
  await botFrames(H, 600); await H.shot('s_boss2', 2);
  H.log(await H.state());
}

// Full run WITHOUT invincibility: measures where the (naive) bot dies. Upper bound on difficulty.
export async function mortal(H) {
  await H.start(0);
  await runbot(H, 60 * 60 * 14, 600, 'm');
  const d = await H.eval(() => { const g = window.__rr.game; return { continues: g.continues, deaths: g.deathLog, mode: g.mode, score: g.score }; });
  const by = {};
  for (const x of d.deaths) { const k = x.area + ':' + x.cause; by[k] = (by[k] ?? 0) + 1; }
  H.log('continues', d.continues, 'deaths', d.deaths.length, 'mode', d.mode, 'score', d.score);
  H.log('deaths by area/cause', by);
  H.log('death x positions', d.deaths.map((x) => x.x).join(' '));
}

// Weapon feel review: each weapon against a fresh squad.
export async function weapons(H) {
  for (const w of ['gat', 'scatter', 'rocket', 'flame']) {
    await H.start(1);
    await H.step(120);
    await H.eval((w) => {
      const g = window.__rr.game;
      const p = g.player;
      p.weapon = w; p.ammo = 200; p.inv = 0;
      g.ents = g.ents.filter((e) => e === p || e.team !== 'enemy');
      const Sold = g.ents.find(() => false);
      void Sold;
    }, w);
    // spawn a squad using the stage helper
    await H.eval(() => {
      const g = window.__rr.game;
      const st = g.stage;
      const x0 = g.player.x + 90;
      st.soldier(g, x0, 'rifle', 'stand', -1);
      st.soldier(g, x0 + 22, 'rifle', 'stand', -1);
      st.soldier(g, x0 + 44, 'grenadier', 'stand', -1);
      st.soldier(g, x0 + 64, 'shield', 'stand', -1);
    });
    const tgt = '({x: window.__rr.game.player.x + 90, y: 150})';
    await H.zsheet('w_' + w, 9, 4, (i) => (w === 'flame' || w === 'gat' || i % 2 ? { fire: true, right: i > 5 } : {}), { target: tgt, w: 200, h: 100, scale: 2, cols: 3 });
  }
}

// Mid-boss + final boss visual passes.
export async function bosses(H) {
  await H.start(1);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 3300; g.cam.x = 3150; g.cam.minX = 3150; g.player.weapon = 'rocket'; g.player.ammo = 99; });
  await botFrames(H, 60);
  const bot = (n) => botFrames(H, n);
  await H.sheet('k_tank', 12, 50, bot, 3, 1, true);
  await H.start(3);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 5320; g.cam.x = 5200; g.player.weapon = 'gat'; g.player.ammo = 999; g.ents = g.ents.filter((e) => e === g.player || e.team !== 'enemy'); });
  await botFrames(H, 400);
  await H.sheet('k_boss1', 12, 70, bot, 3, 1, true);
  await H.sheet('k_boss2', 12, 90, bot, 3, 1, true);
  H.log(await H.state());
}

// Title -> play -> death -> continue -> game over -> title, plus respawn check.
export async function flow(H) {
  await H.step(30);
  await H.shot('f_title', 2);
  await H.step(2, { start: true });
  await H.step(2, {});
  H.log('after start', (await H.state()).mode);
  if ((await H.state()).mode !== 'play') throw new Error('Start did not enter play');
  await H.step(200);
  // die once with lives left: expect respawn
  await H.eval(() => { const g = window.__rr.game; g.player.hurt(g, g.player.x + 10); });
  await H.zsheet('f_death', 12, 5, {}, { w: 96, h: 64, scale: 3, cols: 4 });
  let st = await H.state();
  H.log('after first death', st.mode, 'lives', st.lives, 'pstate', st.pstate);
  await H.step(160);
  st = await H.state();
  H.log('after respawn', st.mode, 'lives', st.lives, 'pstate', st.pstate);
  if (st.mode !== 'play' || st.lives !== 2 || st.pstate === 'dead') throw new Error('Respawn failed');
  // burn remaining lives
  for (let i = 0; i < 2; i++) {
    await H.eval(() => { const g = window.__rr.game; g.player.inv = 0; g.player.hurt(g, g.player.x + 10); });
    await H.step(200);
  }
  st = await H.state();
  H.log('after all lives', st.mode, 'lives', st.lives);
  if (st.mode !== 'continue' || st.lives !== 0) throw new Error('Continue screen was not reached');
  await H.shot('f_continue', 2);
  await H.step(2, { start: true });
  await H.step(2, {});
  st = await H.state();
  H.log('after continue accepted', st.mode, 'lives', st.lives);
  if (st.mode !== 'play' || st.lives !== 3) throw new Error('Continue did not restore play and lives');
  for (let i = 0; i < 3; i++) {
    await H.eval(() => { const g = window.__rr.game; g.player.inv = 0; g.player.hurt(g, g.player.x + 10); });
    await H.step(200);
  }
  await H.step(620);
  st = await H.state();
  H.log('after countdown', st.mode);
  if (st.mode !== 'gameover') throw new Error('Continue timeout did not enter gameover');
  await H.shot('f_gameover', 2);
  await H.step(100);
  await H.step(2, { start: true });
  await H.step(2, {});
  H.log('after gameover press', (await H.state()).mode);
  if ((await H.state()).mode !== 'title') throw new Error('Gameover did not return to title');
}

// Audio sanity: music + sfx + voice actually produce signal (run with --audio).
export async function audiocheck(H) {
  await H.start(0);
  const res = await H.eval(async () => {
    const rr = window.__rr;
    const a = rr.audio;
    rr.initAudio();
    await new Promise((r) => setTimeout(r, 1500));
    rr.start(0);
    const ctx = a.ctx;
    if (!ctx) return 'no audio context';
    await ctx.resume();
    const an = ctx.createAnalyser();
    an.fftSize = 2048;
    a.master.connect(an);
    const buf = new Float32Array(an.fftSize);
    const rms = () => { an.getFloatTimeDomainData(buf); let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length); };
    const out = {};
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    // let the stage run in real time for a bit (music scheduler needs wall-clock time)
    for (let i = 0; i < 90; i++) { rr.step(1); await wait(16); }
    out.music = rms();
    a.playSong(null);
    await wait(600);
    out.silence = rms();
    a.play('expl_m'); await wait(80); out.sfx = rms();
    await wait(1200);
    out.voicesLoaded = ['mission_start', 'enemy_die', 'w_gatling', 'boss_intro'].map((k) => k + ':' + a.hasVoice(k)).join(' ');
    a.voice('mission_start', { priority: true }); await wait(400); out.voice = rms();
    out.state = ctx.state;
    return out;
  });
  H.log(res);
}

// Verify the shipped death voice is loaded and played through the actual damage path.
export async function deathVoice(H) {
  await H.start(0);
  await H.step(200);
  const res = await H.eval(async () => {
    const rr = window.__rr, g = rr.game, a = rr.audio;
    rr.initAudio();
    for (let i = 0; i < 100 && !a.hasVoice('hero_die'); i++) await new Promise((r) => setTimeout(r, 50));
    if (!a.hasVoice('hero_die')) throw new Error('Death voice failed to load');
    await a.ctx.resume();
    a.playSong(null);
    const an = a.ctx.createAnalyser();
    an.fftSize = 2048;
    a.master.connect(an);
    g.player.inv = 0;
    if (!g.player.hurt(g, g.player.x + 10)) throw new Error('Damage did not trigger death');
    await new Promise((r) => setTimeout(r, 450));
    const buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(buf);
    const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
    return { state: a.ctx.state, loaded: a.hasVoice('hero_die'), active: a.active.get('v:hero_die')?.length ?? 0, rms };
  });
  H.log('DEATH VOICE', res);
  if (res.state !== 'running' || res.active !== 1 || res.rms <= 0.001) throw new Error('Death voice did not produce an audio signal');
}

// Debug: what absorbs the player's bullets at the bunker?
export async function dbgBunker(H) {
  await H.start(0);
  await H.step(60);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 1000; g.cam.x = 880; g.cam.minX = 880; });
  await H.step(200, { right: true });
  const r = await H.eval(() => {
    const g = window.__rr.game;
    const log = [];
    for (const e of g.ents) {
      if (!e.hittable) continue;
      const f = e.onHit.bind(e);
      e.onHit = (gg, h) => { const m = f(gg, h); if (m) log.push(`${e.constructor.name}@${Math.round(e.x)},${Math.round(e.y)} by ${h.kind} at ${Math.round(h.x)},${Math.round(h.y)} -> ${m}`); return m; };
    }
    const p = g.player;
    p.x = 1130; p.y = 170; p.vy = 0;
    const deaths = [];
    const seen = new Map();
    for (let i = 0; i < 120; i++) {
      window.__rr.step(1, { fire: i % 4 < 2, jump: i % 45 === 0 });
      for (const e of g.ents) if (e.constructor.name === 'PBullet') seen.set(e, [Math.round(e.x), Math.round(e.y)]);
      for (const [e, pos] of seen) if (e.dead) { deaths.push(pos.join(',') + (g.solidAt(pos[0], pos[1]) ? ' solid' : '')); seen.delete(e); }
    }
    const solids = g.solids.filter((s) => s.alive && s.x < 1260 && s.x + s.w > 1100 && s.y < 184).map((s) => `${s.tag}:${s.x},${s.y},${s.w}x${s.h}${s.oneway ? ' ow' : ''}`);
    return { px: p.x, py: p.y, log: log.slice(0, 12), n: log.length, deaths: deaths.slice(0, 20), solids };
  });
  H.log(r);
  await H.shot('dbg_bunker', 2);
}

export async function dbgStuck(H) {
  await H.start(0);
  await botFrames(H, 1800);
  const r = await H.eval((src) => {
    const g = window.__rr.game;
    const log = [];
    for (const e of g.ents) {
      if (!e.hittable) continue;
      const f = e.onHit.bind(e);
      e.onHit = (gg, h) => { const m = f(gg, h); log.push(`${e.constructor.name}@${Math.round(e.x)} ${h.kind} ${Math.round(h.x)},${Math.round(h.y)} -> ${m}`); return m; };
    }
    const p = g.player;
    const shots0 = g.shots;
    const inputs = [];
    for (let i = 0; i < 120; i++) { const held = eval(src); if (i < 6) inputs.push(JSON.stringify(held)); window.__rr.step(1, held); }
    return { px: Math.round(p.x), py: Math.round(p.y), st: p.state, fireCd: p.fireCd, knife: p.knifeT, thr: p.throwT, shots: g.shots - shots0, inputs, log: log.slice(0, 10), n: log.length };
  }, BOT);
  H.log(r);
}

// Enemy roster close-ups: each role's telegraph and attack.
export async function roster(H) {
  for (const role of ['shield', 'bazooka', 'rusher', 'grenadier']) {
    await H.start(1);
    await H.step(100);
    await H.eval((role) => {
      const g = window.__rr.game;
      g.ents = g.ents.filter((e) => e === g.player || e.team !== 'enemy');
      const s = g.stage.soldier(g, g.player.x + (role === 'rusher' ? 150 : 110), role, 'none', -1);
      s.cd = 10;
    }, role);
    await H.zsheet('e_' + role, 12, role === 'rusher' ? 4 : 7, {}, { target: '({x: window.__rr.game.player.x + 60, y: 160})', w: 170, h: 70, scale: 2, cols: 3 });
  }
  // knife: stand next to a rifleman and tap fire
  await H.start(1);
  await H.step(100);
  await H.eval(() => { const g = window.__rr.game; g.ents = g.ents.filter((e) => e === g.player || e.team !== 'enemy'); g.stage.soldier(g, g.player.x + 16, 'rifle', 'none', -1); });
  await H.zsheet('e_knife', 8, 3, (i) => (i % 3 === 0 ? { fire: true } : {}), { w: 96, h: 60, scale: 3, cols: 4, target: '({x: window.__rr.game.player.x + 12, y: 164})' });
}

export async function results(H) {
  await H.start(3);
  await H.step(60);
  await H.eval(() => { const g = window.__rr.game; g.stage.missionClear(g); });
  for (const n of [100, 200, 400]) {
    await H.step(n - (n === 100 ? 0 : n === 200 ? 100 : 200));
    const st = await H.eval(() => ({ mode: window.__rr.game.mode, modeT: window.__rr.game.modeT }));
    H.log(n, st);
  }
  await H.shot('res_final', 2);
}

// The payoff: final boss destruction sequence + phase 2/3 looks.
export async function bossDeath(H) {
  await H.start(3);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 5330; g.cam.x = 5220; g.player.weapon = 'gat'; g.player.ammo = 999; g.ents = g.ents.filter((e) => e === g.player || e.team !== 'enemy'); });
  await botFrames(H, 420);
  // skip to phase 2, look, then phase 3
  await H.eval(() => { const g = window.__rr.game; const b = g.ents.find((e) => e.constructor.name === 'Boss'); b.clawHp = 1; });
  await botFrames(H, 200);
  await H.shot('bd_phase2', 2);
  await H.eval(() => { const g = window.__rr.game; const b = g.ents.find((e) => e.constructor.name === 'Boss'); b.body = b.maxBody * 0.41; });
  await botFrames(H, 300);
  await H.shot('bd_phase3', 2);
  await H.eval(() => { const g = window.__rr.game; const b = g.ents.find((e) => e.constructor.name === 'Boss'); b.body = 3; });
  const bot = (n) => botFrames(H, n);
  await H.sheet('bd_death', 12, 30, bot, 3, 1, true);
  H.log(await H.state());
}

// README media: key screenshots + a short gameplay GIF frame dump.
export async function readme(H) {
  // wait for a frame where "PRESS START" is visible (blinks every 16 frames)
  await H.step(40);
  while (!((await H.state()).t >> 4 & 1)) await H.step(1);
  await H.step(2);
  await H.shot('rd_title', 2);
  // beach: approach the campfire soldiers and fight
  await H.start(0);
  await H.step(150);
  await botFrames(H, 330);
  await H.shot('rd_beach', 2);
  // gif frames: bunker assault
  await botFrames(H, 250);
  for (let i = 0; i < 60; i++) {
    await botFrames(H, 3);
    await H.shot(`gif_${String(i).padStart(3, '0')}`, 1);
  }
  // town tank
  await H.start(1);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 3300; g.cam.x = 3150; g.cam.minX = 3150; g.player.weapon = 'rocket'; g.player.ammo = 99; });
  await botFrames(H, 300);
  for (const k of ['a', 'b', 'c']) { await botFrames(H, 50); await H.shot('rd_tank_' + k, 2); }
  // train
  await H.start(2);
  await botFrames(H, 1000);
  await H.shot('rd_train', 2);
  // boss
  await H.start(3);
  await H.eval(() => { const g = window.__rr.game; g.player.x = 5330; g.cam.x = 5220; g.player.weapon = 'gat'; g.player.ammo = 999; g.ents = g.ents.filter((e) => e === g.player || e.team !== 'enemy'); });
  await botFrames(H, 700);
  await H.shot('rd_boss', 2);
  await H.eval(() => { const g = window.__rr.game; const b = g.ents.find((e) => e.constructor.name === 'Boss'); if (b) b.clawHp = 1; });
  await botFrames(H, 260);
  await H.shot('rd_boss2', 2);
}

// ------------------------------------------------------------------ bug diagnostics
// 1) title palm jitter: changed pixels per frame inside the two palm crowns
// 2) camera: per-frame jumps > 6px during play (fades excluded)
// 3) enemies whose first frame is already inside the visible screen
export async function diag(H) {
  const palm = await H.eval(() => {
    const rr = window.__rr;
    const g = rr.game;
    const px = g.stage.tmp.px, W = g.s.w;
    const boxes = [[0, 60, 90, 70], [300, 60, 90, 70]];
    // Inspect only foliage in the title backdrop, excluding animated logos/clouds.
    const foliage = new Set([0xff4a8a3a, 0xff3a6024]);
    let prev = null, total = 0, maxd = 0;
    for (let f = 0; f < 120; f++) {
      rr.step(1);
      g.stage.drawTitleBack(g, g.stage.tmp);
      const cur = [];
      for (const [x0, y0, w, h] of boxes) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < Math.min(W, x0 + w); x++) { const c = px[y * W + x]; cur.push(foliage.has(c) ? c : 0); }
      if (prev) { let d = 0; for (let i = 0; i < cur.length; i++) if (cur[i] !== prev[i]) d++; total += d; maxd = Math.max(maxd, d); }
      prev = cur;
    }
    return { avgChangedPx: Math.round(total / 119), maxChangedPx: maxd };
  });
  H.log('TITLE PALMS', palm);

  await H.start(0);
  const res = await H.eval((src) => {
    const rr = window.__rr;
    const g = rr.game;
    const seen = new WeakSet();
    const pops = [];
    const contextual = [];
    const jumps = [];
    let lastCam = g.cam.x, lastArea = g.stage.area;
    for (let f = 0; f < 60 * 60 * 9; f++) {
      rr.step(1, eval(src));
      if (g.mode === 'clear' && g.modeT > 300) break;
      const dx = g.cam.x - lastCam;
      const fading = g.darken > 0.02;
      if (Math.abs(dx) > 6 && !fading && g.stage.area === lastArea) jumps.push(`${g.stage.area}@${Math.round(lastCam)}->${Math.round(g.cam.x)} (t${g.t})`);
      lastCam = g.cam.x; lastArea = g.stage.area;
      for (const e of g.ents) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (e.team !== 'enemy' || !('state' in e || e.constructor.name === 'Gyro')) continue;
        if (!e.hittable && e.state !== 'wait') continue;
        const b = e.box?.();
        if (!b) continue;
        const sx = b.x + b.w / 2 - g.cam.x, sy = b.y + b.h / 2 - g.cam.y;
        if (sx > 8 && sx < 376 && sy > 0 && sy < 216 && e.age <= 1 && g.darken < 0.5) {
          const label = `${e.constructor.name}:${e.role ?? ''} ${e.state ?? ''} @${Math.round(b.x)},${Math.round(b.y)} ${g.stage.area} t${g.t}`;
          if (e.origin) contextual.push(`${e.origin} ${label}`);
          else pops.push(label);
        }
      }
    }
    return { mode: g.mode, jumps: jumps.slice(0, 40), njumps: jumps.length, pops, npops: pops.length, contextual };
  }, BOT);
  H.log('CAMERA JUMPS', res.njumps, res.jumps);
  H.log('ON-SCREEN SPAWNS', res.npops, res.pops);
  H.log('CONTEXTUAL ENTRANCES', res.contextual.length, res.contextual);
  H.log('end mode', res.mode);
  if (res.njumps || res.npops || res.mode !== 'clear') {
    H.log('DIAGNOSTIC END STATE', await H.state());
    H.log('DIAGNOSTIC ENEMIES', await H.eval(() => { const g = window.__rr.game; return g.ents.filter((e) => e.hittable && e.team === 'enemy').map((e) => ({ type: e.constructor.name, x: e.x, y: e.y, state: e.state, hp: e.hp, tag: e.tag })); }));
    await H.shot('diag_failure');
    throw new Error('Camera/spawn diagnostics failed or did not reach mission clear');
  }
}

// death pose + scarf close-up (lying still after the tumble)
export async function deathScarf(H) {
  await H.start(0);
  await H.step(200);
  await H.eval(() => { const g = window.__rr.game; g.player.hurt(g, g.player.x + 10); });
  await H.zsheet('bug_scarf', 12, 7, {}, { w: 96, h: 56, scale: 3, cols: 4 });
  const d = await H.eval(() => {
    const p = window.__rr.game.player;
    const s = p.scarf;
    return { spin: p.spin.toFixed(2), anchor: s[0] && [Math.round(s[0].x - p.x), Math.round(s[0].y - p.y)], tip: s.at(-1) && [Math.round(s.at(-1).x - p.x), Math.round(s.at(-1).y - p.y)] };
  });
  H.log('DEAD SCARF (relative to feet)', d);
  if (!d.anchor || Math.abs(d.anchor[1]) > 6) throw new Error('Scarf still floats above the settled corpse');
  if (await H.eval(() => { const g = window.__rr.game; return g.player.scarf.slice(1).some((p) => !!g.solidAt(p.x, p.y, true)); })) throw new Error('Scarf penetrates the ground');
  await H.start(0);
  await H.step(200);
  await H.eval(() => { const g = window.__rr.game; g.player.facing = -1; g.player.hurt(g, g.player.x - 10); });
  await H.zsheet('bug_scarf_left', 12, 7, {}, { w: 96, h: 56, scale: 3, cols: 4 });
  const left = await H.eval(() => { const p = window.__rr.game.player; return { state: p.state, anchor: [Math.round(p.scarf[0].x - p.x), Math.round(p.scarf[0].y - p.y)] }; });
  H.log('DEAD SCARF (facing left)', left);
  if (left.state !== 'dead' || Math.abs(left.anchor[1]) > 6) throw new Error('Mirrored scarf still floats above the settled corpse');
}
