import { Surface, bayer, hex, mix } from '../engine/surface';
import { drawText } from '../engine/font';
import { audio } from '../engine/audio';
import { getSurface } from '../engine/assets';
import { C } from './palette';
import type { Mat, Solid } from './types';
import { Soldier, Gyro, type Role, type Idle } from './enemies';
import { Crate, Barrel, Sandbags, Hostage, Tower, Bunker, MGNest, SecretHatch } from './props';
import { Gull, Crab, Bottle, Campfire, Balcony, Building } from './decor';
import { Tank, Draisine, Gunship } from './vehicles';
import { Boss } from './boss';
import { gradient, layer, clouds, ridge, sea, sun, palm, flag, SKY } from './bg';
import { SONGS, trainSong } from './music';
import type { BossBar } from './ui';
import { W, H, type Game } from './world';

type Area = 'beach' | 'town' | 'rail' | 'docks';
interface Ev { x: number; fn: (g: Game) => void; done?: boolean }
interface Arena { l: number; r: number; until: (g: Game) => boolean; onClear?: (g: Game) => void }
interface Deco { kind: 'palm' | 'rock' | 'boat' | 'gate' | 'flag' | 'post' | 'lamp' | 'crane' | 'tank' | 'sign' | 'wreck' | 'towel' | 'table' | 'laundry' | 'bollard'; x: number; y: number; a?: number; b?: number }

export const GROUND = 184;
const TOWN_X = 1850;
const STATION_X = 3700;
const TRAIN_L = 3800;
const DOCKS_X = 5000;
const BOSS_L = 5300;
export const RAIL_Y = 200;
export const DECK_Y = 172;
const CAR_L = TRAIN_L + 58;

const hash = (n: number) => {
  const x = Math.sin(n * 91.7 + 17.3) * 43758.5453;
  return x - Math.floor(x);
};

export class Stage {
  area: Area = 'beach';
  events: Ev[] = [];
  arena: Arena | null = null;
  deco: Deco[] = [];
  buildings: Building[] = [];
  tmp = new Surface(W, H);
  rail = { on: false, t: 0, speed: 0, scroll: 0, phase: 'idle' as 'idle' | 'ride' | 'fight' | 'brake' | 'done', phaseT: 0, wave: 0 };
  tank: Tank | null = null;
  heli: Gunship | null = null;
  drai: Draisine | null = null;
  boss: Boss | null = null;
  fade = 0;
  fadeTo: (() => void) | null = null;
  fadeDir = 0;
  lightning = 0;
  clearT = -1;
  goShown = 0;
  barrier: Solid | null = null;
  platform: Solid | null = null;

  // ------------------------------------------------------------------ build
  build(g: Game, section: number) {
    this.buildBeach(g);
    this.buildTown(g);
    this.buildStation(g);
    this.buildDocks(g);
    this.events.sort((a, b) => a.x - b.x);
    g.cam.maxX = TRAIN_L + W + 10;
    const starts = [40, TOWN_X - 60, TRAIN_L + 60, DOCKS_X + 30];
    const sx = starts[section] ?? 40;
    if (section >= 3) {
      this.enterDocks(g, true);
    } else {
      g.player.spawnAt(sx, -10);
      g.cutCamera(Math.max(0, sx - 60));
      for (const e of this.events) if (e.x < g.cam.x + W && section > 0) e.done = true;
      if (section > 0) g.ents = g.ents.filter((e) => e.x > g.cam.x - 20 || e === g.player);
      this.area = this.areaAt(g.cam.x + W / 2);
      if (section === 2) {
        g.player.spawnAt(TRAIN_L + 80, 150);
        g.cutCamera(TRAIN_L);
        this.startTrain(g);
      }
    }
    if (section === 0) {
      g.banner('MISSION 1', 170, 'mission', 'SALTBONE BAY');
      audio.playSong(SONGS.start);
      audio.voice('mission_start', { priority: true });
      g.later(130, () => { if (this.area !== 'docks') audio.playSong(SONGS.stage); });
    } else if (section < 3) audio.playSong(section === 2 ? trainSong() : SONGS.stage);
  }

  private ev(x: number, fn: (g: Game) => void) {
    this.events.push({ x, fn });
  }

  private soldier(g: Game, x: number, role: Role = 'rifle', idle: Idle = 'stand', facing = -1, y = GROUND, tag = '') {
    const s = new Soldier(x, y, role, idle, facing);
    s.tag = tag;
    return g.add(s);
  }

  // A door bursts open (with a short rattle beforehand) and a trooper leaps out of it.
  private ambush(g: Game, b: Building, role: Role, delay: number) {
    g.later(delay, () => {
      b.rattle = 16;
      g.snd('wood', b.door + 7, 0.4, 1.6);
    });
    g.later(delay + 16, () => {
      const dx = b.door + 7;
      b.kickDoor(g);
      const s = this.soldier(g, dx, role, 'none', -1, GROUND, 'amb2');
      s.origin = 'door';
      s.enter('jump', -1.6, -2.4);
    });
  }

  private runIn(g: Game, role: Role, n: number, tag = '', fromLeft = false, spacing = 26) {
    for (let i = 0; i < n; i++) {
      const x = fromLeft ? g.cam.x - 20 - i * spacing : g.cam.x + W + 20 + i * spacing;
      const s = this.soldier(g, x, role, 'none', fromLeft ? 1 : -1, GROUND, tag);
      s.enter('run', fromLeft ? 1.5 : -1.5);
    }
  }

  private lock(g: Game, l: number, r: number, until: (g: Game) => boolean, onClear?: (g: Game) => void) {
    this.arena = { l, r, until, onClear };
    g.cam.lockL = l;
    g.cam.lockR = r;
  }

  // ------------------------------------------------------------------ BEACH
  private buildBeach(g: Game) {
    g.solid(-200, GROUND, 1220, 80, false, 'sand');
    g.solid(1020, GROUND - 6, 150, 86, false, 'sand');
    g.solid(1170, GROUND, TOWN_X - 1170 + 5, 80, false, 'sand');
    for (const [x, h, l] of [[96, 70, 8], [330, 84, -6], [618, 76, 7], [930, 90, -8], [1270, 80, 6], [1520, 88, -7], [1700, 72, 8]]) this.deco.push({ kind: 'palm', x, y: GROUND, a: h, b: l });
    this.deco.push({ kind: 'boat', x: 24, y: GROUND });
    this.deco.push({ kind: 'rock', x: 190, y: GROUND, a: 10 }, { kind: 'rock', x: 470, y: GROUND, a: 7 }, { kind: 'rock', x: 1080, y: GROUND - 6, a: 12 }, { kind: 'rock', x: 1600, y: GROUND, a: 9 });
    this.deco.push({ kind: 'wreck', x: 1420, y: GROUND });
    g.add(new SecretHatch(1440, GROUND - 3));
    this.deco.push({ kind: 'towel', x: 392, y: GROUND });
    this.deco.push({ kind: 'post', x: 150, y: GROUND }, { kind: 'post', x: 520, y: GROUND }, { kind: 'sign', x: 250, y: GROUND });
    this.deco.push({ kind: 'gate', x: TOWN_X - 30, y: GROUND });
    g.add(new Gull(150, GROUND - 26));
    g.add(new Gull(520, GROUND - 22));
    g.add(new Gull(560, GROUND));
    g.add(new Gull(760, GROUND));
    for (const x of [120, 230, 420, 700, 980, 1350, 1560]) g.add(new Crab(x, GROUND));

    // opening vignette: breakfast by the fire, a sunbather, crates to smash
    g.add(new Crate(200, GROUND, 'score'));
    g.add(new Campfire(300, GROUND));
    this.soldier(g, 284, 'rifle', 'eat', 1);
    this.soldier(g, 318, 'rifle', 'eat', -1);
    this.soldier(g, 392, 'rifle', 'sunbathe', -1);
    g.add(new Crate(460, GROUND));
    g.add(new Barrel(488, GROUND));

    // sandbag line with cover troops
    g.add(new Sandbags(596, GROUND, 34));
    const c1 = this.soldier(g, 606, 'rifle', 'chat', -1);
    c1.cover = true;
    const c2 = this.soldier(g, 640, 'grenadier', 'chat', -1);
    c2.cover = true;

    // watchtower + prisoner with the first heavy weapon
    g.add(new Tower(g, 736, GROUND, 58));
    this.soldier(g, 736, 'rifle', 'stand', -1, GROUND - 58);
    g.add(new Hostage(790, GROUND, 'gat'));
    g.add(new Barrel(846, GROUND));
    g.add(new Barrel(860, GROUND));

    // bunker assault (placed at build time so nothing materializes on screen)
    this.soldier(g, 1000, 'rifle', 'chat', 1, GROUND - 6, 'bunker');
    this.soldier(g, 1030, 'rifle', 'chat', -1, GROUND - 6, 'bunker');
    g.add(new Sandbags(1120, GROUND - 6, 30));
    const bunker = g.add(new Bunker(g, 1236, GROUND, 6));
    bunker.tag = 'bunker';
    g.add(new Barrel(1090, GROUND - 6));
    this.ev(1270, (g) => {
      this.lock(g, 900, 1284, (g) => g.countTag('bunker') === 0, (g) => {
        g.banner('', 150, 'go');
      });
    });
    // after the bunker: machete ambush + first gyro
    this.ev(1420, (g) => this.runIn(g, 'rusher', 3, 'amb1'));
    this.ev(1520, (g) => { const gy = g.add(new Gyro(g.cam.x + W + 30, 64)); gy.tag = 'gyro1'; });
    g.add(new Crate(1600, GROUND, 'bombs'));
    this.soldier(g, 1740, 'rifle', 'stand', -1);
    this.soldier(g, 1780, 'grenadier', 'stand', -1);
    // gate guards stand on the arch, then drop down
    const archTop = g.solid(TOWN_X - 40, GROUND - 74, 80, 4, true, 'arch');
    void archTop;
    this.soldier(g, TOWN_X - 20, 'rifle', 'stand', -1, GROUND - 74);
    this.soldier(g, TOWN_X + 14, 'rifle', 'stand', -1, GROUND - 74);
  }

  // ------------------------------------------------------------------ TOWN
  private buildTown(g: Game) {
    g.solid(TOWN_X, GROUND, STATION_X - TOWN_X, 80, false, 'cobble');
    const P = [
      { x: 1900, w: 92, h: 118, c: C.plaster, s: C.plasterSh, r: C.roof, awn: undefined as number | undefined, sign: undefined as string | undefined },
      { x: 2000, w: 76, h: 84, c: hex('#e8c890'), s: hex('#b8986a'), r: C.roofSh, awn: 34, sign: 'CAFE' },
      { x: 2084, w: 104, h: 126, c: hex('#e8b8a8'), s: hex('#b88878'), r: C.roof, awn: undefined, sign: undefined },
      { x: 2196, w: 84, h: 96, c: C.plaster, s: C.plasterSh, r: C.roofSh, awn: 36, sign: 'FISH' },
      { x: 2290, w: 110, h: 132, c: hex('#d8d0b0'), s: hex('#a8a080'), r: C.roof, awn: undefined, sign: undefined },
      { x: 2410, w: 90, h: 100, c: hex('#e8c890'), s: hex('#b8986a'), r: C.roof, awn: undefined, sign: undefined },
      { x: 2510, w: 100, h: 120, c: C.plaster, s: C.plasterSh, r: C.roofSh, awn: undefined, sign: undefined },
      { x: 2640, w: 120, h: 90, c: hex('#e8b8a8'), s: hex('#b88878'), r: C.roof, awn: 34, sign: 'BAR SALT' },
      { x: 2770, w: 90, h: 122, c: hex('#d8d0b0'), s: hex('#a8a080'), r: C.roof, awn: undefined, sign: undefined },
      { x: 2870, w: 96, h: 108, c: C.plaster, s: C.plasterSh, r: C.roofSh, awn: undefined, sign: undefined },
      { x: 2976, w: 80, h: 90, c: hex('#e8c890'), s: hex('#b8986a'), r: C.roof, awn: 36, sign: undefined },
      { x: 3066, w: 110, h: 128, c: hex('#e8b8a8'), s: hex('#b88878'), r: C.roofSh, awn: undefined, sign: undefined },
      { x: 3186, w: 70, h: 96, c: C.plaster, s: C.plasterSh, r: C.roof, awn: undefined, sign: undefined },
      { x: 3560, w: 110, h: 124, c: hex('#d8d0b0'), s: hex('#a8a080'), r: C.roof, awn: undefined, sign: 'ARMORY' },
    ];
    for (const b of P) {
      const bd = g.add(new Building(g, b.x, b.w, b.h, b.c, b.s, b.r, GROUND, { awning: b.awn, sign: b.sign }));
      this.buildings.push(bd);
    }
    // square: fountain, flags
    this.deco.push({ kind: 'flag', x: 3290, y: GROUND - 64 }, { kind: 'flag', x: 3470, y: GROUND - 64 });
    this.deco.push({ kind: 'lamp', x: 1990, y: GROUND }, { kind: 'lamp', x: 2400, y: GROUND }, { kind: 'lamp', x: 2860, y: GROUND }, { kind: 'lamp', x: 3280, y: GROUND });
    this.deco.push({ kind: 'laundry', x: 2190, y: GROUND - 110, a: 100 }, { kind: 'laundry', x: 2760, y: GROUND - 104, a: 110 });
    this.deco.push({ kind: 'table', x: 2690, y: GROUND }, { kind: 'table', x: 2730, y: GROUND });
    for (const [x, c] of [[2686, C.green], [2692, C.brass], [2728, C.green], [2734, C.red]] as [number, number][]) g.add(new Bottle(x, GROUND - 9, c));
    for (const x of [2300, 2700, 3000]) g.add(new Gull(x, GROUND));

    // balconies with snipers
    const bal1 = g.add(new Balcony(g, 1914, GROUND - 60, 42));
    const bal2 = g.add(new Balcony(g, 2110, GROUND - 70, 48));
    void bal1; void bal2;
    this.soldier(g, 1935, 'rifle', 'stand', -1, GROUND - 60);
    this.soldier(g, 2134, 'grenadier', 'stand', -1, GROUND - 70);
    // first shield trooper escorted by a rifleman
    this.ev(2100, (g) => {
      const s = this.soldier(g, g.cam.x + W + 20, 'shield', 'none', -1);
      s.enter('run', -0.8);
      const r = this.soldier(g, g.cam.x + W + 60, 'rifle', 'none', -1);
      r.enter('run', -1.2);
    });
    g.add(new Hostage(2240, GROUND, 'scatter'));

    // MG nest arena (build time: the nest only fires once it is on screen)
    const nest = g.add(new MGNest(g, 2560, GROUND));
    nest.tag = 'mg';
    g.add(new Balcony(g, 2424, GROUND - 84, 36));
    this.soldier(g, 2440, 'bazooka', 'stand', -1, GROUND - 84, 'mg');
    this.soldier(g, 2266, 'rifle', 'stand', -1, GROUND - 36, 'mg');
    const gr = this.soldier(g, 2600, 'grenadier', 'stand', -1, GROUND, 'mg');
    gr.cover = true;
    this.soldier(g, 2500, 'shield', 'stand', -1, GROUND, 'mg');
    this.ev(2600, (g) => {
      this.lock(g, 2250, 2634, (g) => g.countTag('mg') === 0, (g) => g.banner('', 150, 'go'));
      g.later(200, () => this.runIn(g, 'rifle', 2, 'mg'));
    });
    // cafe breather: bombs, and a flamethrower right before the door ambush
    g.add(new Crate(2680, GROUND, 'bombs'));
    g.add(new Crate(2820, GROUND, 'flame', true));
    // door ambush: doors are kicked open and the troops leap out of them
    const doorOf = (bx: number) => this.buildings.find((b) => b.x === bx)!;
    this.ev(3030, (g) => {
      this.ambush(g, doorOf(2870), 'rusher', 0);
      this.ambush(g, doorOf(2976), 'rusher', 20);
    });
    this.ev(3150, (g) => this.ambush(g, doorOf(3066), 'rifle', 0));
    this.ev(3000, (g) => {
      g.add(new Gyro(g.cam.x + W + 30, 58));
      g.later(90, () => g.add(new Gyro(g.cam.x + W + 30, 80)));
    });
    // rocket trooper perched on an awning: shoot his rockets down or jump them
    this.soldier(g, 3010, 'bazooka', 'stand', -1, GROUND - 36);
    g.add(new Hostage(3120, GROUND, 'rocket'));
    g.add(new Barrel(3200, GROUND));
    g.add(new Barrel(3214, GROUND));
    g.add(new Crate(3240, GROUND));

    // IRONPOT tank mid-boss bursts out of the armory (trigger close to the arena so the
    // camera only has a short pan to settle into it)
    this.ev(3600, (g) => {
      const armory = this.buildings[this.buildings.length - 1];
      const t = g.add(new Tank(g, armory.x + armory.w / 2, GROUND, 3250, 3634, armory));
      this.tank = t;
      t.tag = 'tank';
      t.rumble = true;
      this.lock(g, 3250, 3634, (g) => !!this.tank && this.tank.state === 'dying' && this.tank.st > 110 && g.countTag('tank') === 0, (g) => {
        g.banner('', 200, 'go');
        this.tank = null;
        audio.playSong(SONGS.stage);
      });
      g.later(60, () => {
        g.banner('WARNING', 110, 'warn', 'ARMORED TANK IRONPOT');
        g.snd('siren', g.cam.x + W / 2, 0.6);
        audio.playSong(SONGS.boss);
      });
      g.later(170, () => { t.state = 'enter'; t.st = 0; t.rumble = false; });
    });
  }

  // ------------------------------------------------------------------ STATION + TRAIN
  private buildStation(g: Game) {
    this.platform = g.solid(STATION_X, GROUND - 8, CAR_L - STATION_X, 88, false, 'concrete');
    g.solid(CAR_L, DECK_Y, TRAIN_L + W + 30 - CAR_L, 14, false, 'deck');
    g.solid(TRAIN_L - 60, RAIL_Y, W + 120, 60, false, 'ballast');
    // the back of the flatcar becomes a wall once the train is rolling
    this.barrier = g.solid(CAR_L - 6, -200, 6, DECK_Y + 200, false, 'barrier');
    this.barrier.alive = false;
    g.add(new Crate(TRAIN_L + 300, DECK_Y, 'bombs'));
    g.add(new Crate(TRAIN_L + 322, DECK_Y, 'rocket', true));
    this.deco.push({ kind: 'sign', x: STATION_X + 40, y: GROUND - 8, a: 1 });
    this.ev(TRAIN_L + 200, (g) => {
      g.cam.lockL = TRAIN_L;
      g.cam.lockR = TRAIN_L + W;
    });
  }

  startTrain(g: Game) {
    if (this.rail.on) return;
    this.rail.on = true;
    this.rail.t = 0;
    this.rail.phase = 'ride';
    this.area = 'rail';
    if (this.barrier) this.barrier.alive = true;
    if (this.platform) this.platform.alive = false;
    const p = g.player;
    if (p.x < CAR_L + 8) p.x = CAR_L + 8;
    g.cam.lockL = TRAIN_L;
    g.cam.lockR = TRAIN_L + W;
    g.cam.forward = false;
    g.banner('HOLD ON!', 110, 'small', 'THE COASTAL LINE');
    audio.voice('hero_train', { priority: true });
    g.snd('siren', g.cam.x + 300, 0.3, 1.8);
    g.shake(5);
    audio.playSong(trainSong());
  }

  private updateTrain(g: Game) {
    const r = this.rail;
    r.t++;
    r.phaseT++;
    const target = r.phase === 'brake' ? 0 : 5.5;
    r.speed += (target - r.speed) * (r.phase === 'brake' ? 0.012 : 0.01);
    r.scroll += r.speed;
    audio.loop('train', Math.min(0.5, r.speed * 0.1));
    if (r.t % 50 === 0) g.shake(0.8);
    const cx = g.cam.x;
    if (r.phase === 'ride') {
      if (r.t === 220) { g.add(new Gyro(cx + W + 30, 60, 2)); g.later(60, () => g.add(new Gyro(cx + W + 30, 84, 2))); }
      if (r.t === 520) {
        // overpass: troopers leap down onto the flatcar
        for (let i = 0; i < 3; i++) g.later(i * 16, () => {
          const bridgeX = W + 40 - (this.rail.t - 440) * 3;
          const s = this.soldier(g, cx + bridgeX + 35, i === 1 ? 'grenadier' : 'rifle', 'none', -1, 30);
          s.enter('jump', -0.2, 0);
          s.tag = 'rail';
          s.origin = 'bridge';
        });
      }
      if (r.t === 820) {
        const d = g.add(new Draisine(cx - 90, RAIL_Y));
        this.drai = d;
        d.onDead = () => { this.drai = null; };
        g.banner('', 1, 'small');
      }
      if (r.t > 840 && !this.drai && r.phase === 'ride') {
        r.phase = 'fight';
        r.phaseT = 0;
      }
      if (r.t > 2400 && this.drai) { this.drai.dead = true; this.drai = null; }
    } else if (r.phase === 'fight') {
      if (r.phaseT === 60) {
        g.banner('WARNING', 110, 'warn', 'GUNSHIP HORNET');
        g.snd('siren', cx + 200, 0.6);
        audio.playSong(SONGS.boss);
      }
      if (r.phaseT === 150) {
        const h = g.add(new Gunship(cx + W + 80, 30));
        this.heli = h;
        h.onDead = () => {
          this.heli = null;
          r.phase = 'brake';
          r.phaseT = 0;
          audio.playSong(trainSong());
        };
      }
    } else if (r.phase === 'brake') {
      if (r.phaseT === 60) { g.banner('NEXT STOP', 150, 'small', 'CANNERY DOCKS'); }
      if (r.phaseT > 100 && r.phaseT % 3 === 0) {
        g.fx.sparks(cx + 60 + Math.random() * 260, GROUND - 2, 2, -Math.PI * 0.8, 0.4, 3);
        if (r.phaseT % 12 === 0) g.snd('ping', cx + 200, 0.2, 0.5);
      }
      if (r.phaseT === 300) {
        this.fadeOut(() => this.enterDocks(g, false));
      }
    }
  }

  private fadeOut(then: () => void) {
    this.fadeDir = 1;
    this.fadeTo = then;
  }

  // ------------------------------------------------------------------ DOCKS
  private buildDocks(g: Game) {
    g.solid(DOCKS_X - 40, GROUND, 740, 80, false, 'pier');
    for (const [x, kind] of [[5060, 'crane'], [5200, 'tank'], [5390, 'bollard'], [5470, 'bollard']] as [number, Deco['kind']][]) this.deco.push({ kind, x, y: GROUND });
  }

  enterDocks(g: Game, fromMenu: boolean) {
    this.area = 'docks';
    this.rail.on = false;
    this.rail.phase = 'done';
    audio.loop('train', 0);
    g.ents = g.ents.filter((e) => e === g.player);
    g.fx.clear();
    g.cam.lockL = -1;
    g.cam.lockR = -1;
    g.cam.forward = true;
    g.cutCamera(DOCKS_X);
    g.cam.maxX = BOSS_L + W;
    g.player.spawnAt(DOCKS_X + 40, fromMenu ? -10 : 120);
    g.player.vx = 1.5;
    this.events = this.events.filter((e) => e.x >= DOCKS_X);
    for (const x of [5240, 5460]) g.add(new Gull(x, GROUND));
    g.add(new Hostage(5120, GROUND, 'gat'));
    g.add(new Crate(5160, GROUND, 'bombs'));
    g.add(new Barrel(5230, GROUND));
    g.add(new Barrel(5244, GROUND));
    this.soldier(g, 5210, 'rifle', 'chat', 1);
    this.soldier(g, 5250, 'bazooka', 'chat', -1);
    this.soldier(g, 5290, 'grenadier', 'stand', -1);
    const sh = this.soldier(g, 5330, 'shield', 'stand', -1);
    void sh;
    this.events.push({ x: BOSS_L + W, fn: (g) => this.startBoss(g) });
    this.fadeDir = -1;
    this.fade = 1;
    g.banner('FINAL AREA', 150, 'mission', 'CANNERY DOCKS');
    audio.playSong(SONGS.stage);
  }

  private startBoss(g: Game) {
    // wait until stragglers are gone, then lock the arena
    this.lock(g, BOSS_L, BOSS_L + W, () => this.clearT >= 0, undefined);
    g.later(40, () => {
      audio.playSong(null);
      g.snd('siren', g.cam.x + W / 2, 0.8);
      g.banner('WARNING', 170, 'warn', 'GIANT ENEMY APPROACHING');
      audio.voice('warning', { priority: true });
    });
    g.later(80, () => {
      const b = g.add(new Boss(BOSS_L + 300, GROUND, BOSS_L, BOSS_L + W));
      this.boss = b;
      b.tag = 'boss';
      b.onDead = () => this.missionClear(g);
    });
    g.later(210, () => audio.playSong(SONGS.boss));
  }

  private missionClear(g: Game) {
    this.clearT = 0;
    this.boss = null;
    g.setMode('clear');
    audio.playSong(SONGS.clear);
    g.later(20, () => audio.voice('mission_complete', { priority: true }));
    g.later(110, () => audio.voice('hero_win', { priority: true }));
    const p = g.player;
    p.state = 'victory';
    p.victoryT = 0;
    p.inv = 0;
    if (g.score > g.hiscore) {
      g.hiscore = g.score;
      try { localStorage.setItem('rr_hi', String(g.score)); } catch { /* ignore */ }
    }
  }

  // ------------------------------------------------------------------ update
  update(g: Game) {
    // fades
    if (this.fadeDir > 0) {
      this.fade = Math.min(1, this.fade + 0.03);
      if (this.fade >= 1 && this.fadeTo) {
        const f = this.fadeTo;
        this.fadeTo = null;
        f();
      }
    } else if (this.fadeDir < 0) {
      this.fade = Math.max(0, this.fade - 0.03);
      if (this.fade <= 0) this.fadeDir = 0;
    }
    g.darken = this.fade;
    if (this.clearT >= 0) this.clearT++;

    const right = g.cam.x + W;
    for (const e of this.events) {
      if (!e.done && right >= e.x) {
        e.done = true;
        e.fn(g);
      }
    }
    if (this.arena && this.arena.until(g)) {
      const a = this.arena;
      this.arena = null;
      g.cam.lockL = -1;
      g.cam.lockR = -1;
      if (a.onClear) a.onClear(g);
    }
    // board the train
    const p = g.player;
    if (!this.rail.on && this.area !== 'docks' && p.x > CAR_L + 16 && p.onGround && p.y <= DECK_Y + 0.5) this.startTrain(g);
    if (this.rail.on) this.updateTrain(g);
    if (!this.rail.on && this.area !== 'docks') this.area = this.areaAt(g.cam.x + W / 2);
    // storm lightning at the docks
    if (this.area === 'docks') {
      if (this.lightning > 0) this.lightning--;
      else if (Math.random() < 0.004) {
        this.lightning = 8;
        g.later(20, () => audio.play('expl_l', { vol: 0.25, pitch: 0.5 }));
      }
    }
  }

  areaAt(x: number): Area {
    if (this.rail.on) return 'rail';
    if (x >= DOCKS_X - 100) return 'docks';
    if (x >= TOWN_X - 60) return 'town';
    return 'beach';
  }

  matAt(g: Game, x: number, y: number): Mat {
    const s = g.solidAt(x, y);
    if (!s) return 'stone';
    if (s.tag === 'sand') return 'sand';
    if (s.tag === 'pier' || s.tag === 'tower' || s.tag === 'balcony') return 'wood';
    if (s.tag === 'deck') return 'metal';
    return 'stone';
  }

  onExplosion(g: Game, x: number, y: number, r: number) {
    for (const b of this.buildings) if (x > b.x - 40 && x < b.x + b.w + 40) b.blast(g, x, y, r);
    for (const e of g.ents) if (e instanceof Gull && Math.abs(e.x - x) < 160) e.scare(g);
  }

  bossBar(): BossBar | null {
    if (this.tank && this.tank.state !== 'wait' && this.tank.state !== 'dying') return { name: 'IRONPOT', frac: this.tank.hp / this.tank.maxHp };
    if (this.heli && this.heli.state !== 'dying') return { name: 'HORNET', frac: this.heli.hp / this.heli.maxHp };
    if (this.drai && this.drai.state !== 'dying') return { name: 'RAIL RAIDER', frac: this.drai.hp / this.drai.maxHp };
    if (this.boss && this.boss.state !== 'rise' && this.boss.state !== 'dying') return { name: 'BARNACLE KING', frac: this.boss.hpFrac() };
    return null;
  }

  // ------------------------------------------------------------------ drawing
  drawBack(g: Game, s: Surface, cx: number, cy: number) {
    s.ox = 0;
    s.oy = 0;
    const a = this.area;
    if (a === 'rail') {
      this.backRail(g, s);
      // crossfade from the station as the train pulls out
      if (this.rail.t < 90) {
        this.backTown(g, this.tmp, cx, cy);
        blend(s, this.tmp, 1 - this.rail.t / 90);
      }
      return;
    }
    if (a === 'docks') return this.backDocks(g, s, cx, cy);
    // beach <-> town crossfade
    const k = Math.max(0, Math.min(1, (cx + W / 2 - (TOWN_X - 260)) / 220));
    if (k <= 0) this.backBeach(g, s, cx, cy);
    else if (k >= 1) this.backTown(g, s, cx, cy);
    else {
      this.backBeach(g, s, cx, cy);
      this.backTown(g, this.tmp, cx, cy);
      blend(s, this.tmp, k);
    }
  }

  private backBeach(g: Game, s: Surface, cx: number, _cy: number) {
    const img = getSurface('bg_beach');
    if (img) {
      layer(s, img, cx, 0.1, 0);
      clouds(s, cx, 0.16, 70, g.t, hex('#fff0e0'), hex('#f0b8a8'), 3, 3, 0.04);
      sea(s, 150, 168, cx, 0.3, g.t, hex('#1a98a8'), hex('#30b0b8'), hex('#c8f0e8'));
    } else {
      gradient(s, 0, 132, SKY.dawn);
      sun(s, 70 - cx * 0.02, 96, 12, hex('#fff4d0'), hex('#ffd8a0'));
      clouds(s, cx, 0.05, 26, g.t, hex('#fff0e0'), hex('#f0c0b0'), 3, 7, 0.03);
      ridge(s, cx, 0.08, 128, 26, hex('#a8a0b8'), 1, hex('#c8c0d0'));
      sea(s, 132, 168, cx, 0.3, g.t, hex('#3a90b0'), hex('#78c8d0'), hex('#d8f4f0'));
    }
    // surf line
    const o = cx * 0.55;
    for (let x = 0; x < W; x++) {
      const y = 166 + Math.round(Math.sin((x + o) * 0.05 + g.t * 0.04) * 1.5);
      s.rect(x, y, 1, 3, bayer(x, y) < 0.6 ? C.offwhite : hex('#a8e0e0'));
    }
    s.rect(0, 169, W, H - 169, C.sandSh);
    ridge(s, cx, 0.6, 186, 14, C.sandSh, 4, C.sand);
  }

  private backTown(g: Game, s: Surface, cx: number, _cy: number) {
    gradient(s, 0, 150, SKY.day);
    const img = getSurface('bg_town');
    if (img) {
      layer(s, img, cx, 0.12, 186 - img.h);
      return;
    }
    clouds(s, cx, 0.06, 20, g.t, C.white, hex('#c8d8ec'), 5, 6, 0.05);
    ridge(s, cx, 0.1, 150, 40, hex('#a8b0c0'), 2, hex('#c8d0dc'));
    // hazy rooftops
    const o = cx * 0.45;
    for (let i = -1; i < 12; i++) {
      const bw = 44 + Math.floor(hash(i + Math.floor(o / 50)) * 20);
      const bx = Math.round(i * 50 - (o % 50));
      const bh = 30 + Math.floor(hash(i * 3 + Math.floor(o / 50)) * 30);
      s.rect(bx, 176 - bh, bw - 4, bh, hex('#c8c4c0'));
      s.rect(bx - 2, 176 - bh - 3, bw, 3, hex('#b88c80'));
      for (let wy = 176 - bh + 6; wy < 170; wy += 10) for (let wx = bx + 4; wx < bx + bw - 10; wx += 10) s.rect(wx, wy, 4, 5, hex('#9aa0b0'));
    }
    s.rect(0, 176, W, 10, hex('#b8b0a4'));
  }

  private backRail(g: Game, s: Surface) {
    const sc = this.rail.scroll;
    const img = getSurface('bg_rail');
    if (img) {
      layer(s, img, sc, 0.06, 0);
      sea(s, 156, 172, sc, 0.2, g.t, hex('#1a3a78'), hex('#2a4a88'), hex('#f0c070'));
    } else {
      gradient(s, 0, 150, [hex('#4a8ad0'), hex('#78aae0'), hex('#a8c8e8'), hex('#f0d8b0'), hex('#f8c890')]);
      clouds(s, sc, 0.08, 18, g.t, C.white, hex('#e0c8c0'), 7, 7, 0.02);
      ridge(s, sc, 0.05, 140, 40, hex('#b0a0a0'), 9, hex('#d0c0b8'));
      sea(s, 140, 160, sc, 0.15, g.t, hex('#3080a8'), hex('#68b0c8'), hex('#d0eef0'));
    }
    ridge(s, sc, 0.35, 170, 18, hex('#a07860'), 11, hex('#c09070'));
    ridge(s, sc, 0.7, 188, 14, hex('#806050'), 12, hex('#9a7258'));
    // trackside embankment rushing past (visible between the bogies)
    s.rect(0, 188, W, 14, hex('#6a5244'));
    const eo = Math.floor(sc * 0.95);
    for (let x = 0; x < W; x++) {
      const h = hash(x + eo);
      if (h < 0.25) s.hline(x, x + 8, 190 + Math.floor(h * 40) % 10, hex('#8a6a50'));
      if (h > 0.985) { s.line(x, 199, x + 1, 192, C.leafSh); s.line(x + 2, 199, x + 4, 194, C.leaf); }
    }
    // telegraph poles + wires (fast parallax)
    const po = (sc * 1.1) % 140;
    for (let x = -po; x < W + 140; x += 140) {
      s.orect(x, 70, 3, 110, C.woodSh);
      s.orect(x - 8, 74, 19, 2, C.woodSh);
    }
    for (let x = 0; x < W; x++) {
      const k = ((x + po) % 140) / 140;
      const sag = Math.round(Math.sin(k * Math.PI) * 6);
      s.pset(x, 76 + sag, C.gunSh);
      s.pset(x, 80 + sag, C.gunSh);
    }
    // overpass bridge passing overhead (t 470..640)
    const bt = this.rail.t - 440;
    if (bt > 0 && bt < 240) {
      const bx = W + 40 - bt * 3;
      s.orect(bx, 0, 70, 30, C.stoneSh);
      s.rect(bx, 26, 70, 4, C.stoneDk);
      s.orect(bx + 8, 30, 10, 60, C.stoneSh);
      s.orect(bx + 52, 30, 10, 60, C.stoneSh);
    }
  }

  private backDocks(g: Game, s: Surface, cx: number, _cy: number) {
    const img = getSurface('bg_docks');
    if (img) layer(s, img, cx, 0.1, 0);
    else {
      gradient(s, 0, 150, SKY.storm);
      clouds(s, cx, 0.05, 10, g.t, hex('#4a3a54'), hex('#2a2238'), 9, 8, 0.2);
      ridge(s, cx, 0.1, 150, 30, hex('#3a3040'), 3, hex('#4a3a50'));
      for (let i = 0; i < 6; i++) {
        const x = Math.round(i * 90 - (cx * 0.2) % 90);
        s.rect(x, 90, 30, 70, hex('#40343c'));
        s.rect(x + 20, 60, 6, 30, hex('#40343c'));
      }
    }
    sea(s, 166, 216, cx, 0.3, g.t, hex('#141c30'), hex('#26304a'), hex('#8a6a78'));
    if (this.lightning > 0 && this.lightning % 4 < 2) s.brect(0, 0, W, 166, C.white, 0.3);
  }

  drawWorld(g: Game, s: Surface) {
    const t = g.t;
    const L = s.ox - 60, R = s.ox + W + 60;
    // background decor (behind characters)
    for (const d of this.deco) {
      if (d.x < L - 80 || d.x > R + 80) continue;
      this.drawDeco(g, s, d, t);
    }
    // the station platform slides away as the train pulls out
    if (this.rail.on && this.platform && this.rail.scroll < 500) {
      const p = this.platform;
      this.groundConcrete(s, { ...p, x: p.x - this.rail.scroll });
    }
    // ground
    for (const so of g.solids) {
      if (!so.alive || so.x > R || so.x + so.w < L) continue;
      if (so.tag === 'sand') this.groundSand(s, so);
      else if (so.tag === 'cobble') this.groundCobble(s, so);
      else if (so.tag === 'concrete') this.groundConcrete(s, so);
      else if (so.tag === 'pier') this.groundPier(g, s, so);
      else if (so.tag === 'ballast') this.groundRail(g, s, so);
      else if (so.tag === 'deck') this.drawFlatcar(g, s, so);
      else if (so.tag === 'arch') { /* drawn with the gate */ }
    }
  }

  drawFront(g: Game, s: Surface) {
    const a = this.area;
    if (a === 'beach') {
      // grass tufts in the foreground
      const o = s.ox * 1.25;
      for (let i = -1; i < 10; i++) {
        const x = Math.round(i * 60 - (o % 60) + s.ox + hash(i + Math.floor(o / 60)) * 20);
        for (let k = 0; k < 5; k++) s.othick(x + k * 2, 216, x + k * 2 + (k - 2), 206 + (k % 2) * 2 + Math.round(Math.sin(g.t * 0.05 + k) * 1), 1, C.leaf);
      }
    }
    if (a === 'rail') {
      // speed lines
      for (let i = 0; i < 6; i++) {
        const y = 30 + ((i * 53 + (g.t * 7) % 17) % 140);
        const x = s.ox + ((W - ((g.t * 14 + i * 97) % (W + 80))) | 0);
        s.hline(x, x + 24, y, C.white);
      }
    }
    if (a === 'docks') {
      // rain
      for (let i = 0; i < 70; i++) {
        const x = s.ox + ((i * 73 + g.t * 3) % (W + 40)) - 20;
        const y = s.oy + ((i * 131 + g.t * 9) % (H + 20)) - 10;
        s.line(x, y, x - 2, y + 6, hex('#8a9ab8'));
      }
    }
    if (this.area === 'rail') {
      // foreground rail fence blur at the very bottom
      const o = (this.rail.scroll * 1.6) % 48;
      for (let x = -o; x < W; x += 48) s.rect(s.ox + x, 208, 20, 8, C.stoneDk);
    }
  }

  // ------------------------------------------------------------------ decor painters
  private drawDeco(g: Game, s: Surface, d: Deco, t: number) {
    switch (d.kind) {
      case 'palm': palm(s, d.x, d.y, d.a ?? 70, t, d.b ?? 6, d.x); break;
      case 'rock':
        s.odisc(d.x, d.y - 2, d.a ?? 8, C.stoneSh);
        s.disc(d.x - 2, d.y - 4, (d.a ?? 8) * 0.6, C.stone);
        s.rect(d.x - (d.a ?? 8) - 1, d.y, (d.a ?? 8) * 2 + 2, 2, C.sandSh);
        break;
      case 'boat':
        s.othick(d.x - 26, d.y - 12, d.x + 26, d.y - 12, 3, C.woodHi);
        s.orect(d.x - 24, d.y - 12, 48, 10, C.teal);
        s.rect(d.x - 24, d.y - 12, 48, 2, C.white);
        s.rect(d.x - 20, d.y - 3, 40, 3, C.tealSh);
        s.othick(d.x + 4, d.y - 12, d.x + 30, d.y - 30, 1, C.woodSh);
        break;
      case 'towel':
        s.rect(d.x - 14, d.y - 1, 28, 2, C.red);
        for (let i = -14; i < 14; i += 4) s.rect(d.x + i, d.y - 1, 2, 2, C.white);
        s.othick(d.x + 18, d.y, d.x + 22, d.y - 26, 1, C.steelSh);
        for (let i = 0; i < 6; i++) s.othick(d.x + 22, d.y - 26, d.x + 22 + Math.cos(Math.PI + i * 0.63) * 16, d.y - 22 + Math.sin(Math.PI + i * 0.63) * -4, 1, i % 2 ? C.yellow : C.red);
        break;
      case 'post':
        s.orect(d.x - 2, d.y - 22, 4, 22, C.woodSh);
        s.rect(d.x - 2, d.y - 22, 4, 1, C.woodHi);
        break;
      case 'sign':
        s.orect(d.x - 1, d.y - 26, 3, 26, C.woodSh);
        s.orect(d.x - 18, d.y - 34, 36, 12, d.a ? C.teal : C.wood);
        drawText(s, d.a ? 'STATION' : 'BEACH', d.x, d.y - 32, d.a ? C.white : C.woodSh, { align: 'center', outline: null });
        break;
      case 'wreck':
        s.orect(d.x - 40, d.y - 22, 80, 22, C.rust);
        s.rect(d.x - 40, d.y - 22, 80, 3, C.fire3);
        s.orect(d.x + 20, d.y - 40, 16, 18, C.rustSh);
        s.rect(d.x - 30, d.y - 14, 8, 6, C.black);
        s.rect(d.x - 10, d.y - 14, 8, 6, C.black);
        s.othick(d.x - 44, d.y - 6, d.x - 60, d.y - 2, 3, C.rustSh);
        break;
      case 'gate': {
        const x = d.x, y = d.y;
        s.orect(x - 50, y - 74, 20, 74, C.stone);
        s.orect(x + 30, y - 74, 20, 74, C.stone);
        s.orect(x - 50, y - 86, 100, 14, C.stone);
        for (let i = 0; i < 5; i++) s.orect(x - 48 + i * 20, y - 94, 12, 8, C.stone);
        s.rect(x - 50, y - 86, 100, 2, C.plaster);
        s.rect(x - 30, y - 72, 60, 2, C.stoneSh);
        for (let k = 0; k < 6; k++) { s.rect(x - 48, y - 70 + k * 12, 16, 1, C.stoneSh); s.rect(x + 32, y - 64 + k * 12, 16, 1, C.stoneSh); }
        flag(s, x - 8, y - 124, t, C.teal, C.tealSh, 18);
        break;
      }
      case 'flag': flag(s, d.x, d.y, t, C.teal, C.tealSh, 22); s.orect(d.x - 2, d.y + 34, 5, 30, C.steelSh); break;
      case 'lamp':
        s.othick(d.x, d.y, d.x, d.y - 44, 1, C.gunSh);
        s.othick(d.x, d.y - 44, d.x + 6, d.y - 48, 1, C.gunSh);
        s.orect(d.x + 4, d.y - 48, 5, 5, C.fire1);
        break;
      case 'laundry': {
        const w = d.a ?? 100;
        for (let i = 0; i <= w; i += 2) s.pset(d.x + i, d.y + Math.round(Math.sin((i / w) * Math.PI) * 8), C.gunSh);
        for (let i = 10; i < w - 10; i += 16) {
          const yy = d.y + Math.round(Math.sin((i / w) * Math.PI) * 8);
          const sw = Math.round(Math.sin(t * 0.06 + i) * 1.5);
          s.orect(d.x + i + sw, yy + 1, 8, 10, [C.white, C.red, C.blue, C.yellow][(i / 16) % 4 | 0]);
        }
        break;
      }
      case 'table':
        s.orect(d.x - 10, d.y - 9, 20, 2, C.woodSh);
        s.othick(d.x, d.y - 8, d.x, d.y, 1, C.gunSh);
        s.othick(d.x - 5, d.y, d.x + 5, d.y, 1, C.gunSh);
        break;
      case 'crane':
        s.orect(d.x, d.y - 150, 8, 150, C.yellow);
        for (let y = d.y - 146; y < d.y; y += 10) s.line(d.x + 1, y, d.x + 6, y + 8, C.hudSh);
        s.orect(d.x - 60, d.y - 156, 140, 7, C.yellow);
        s.othick(d.x + 40, d.y - 150, d.x + 40, d.y - 80, 1, C.gunSh);
        s.orect(d.x + 34, d.y - 80, 12, 8, C.gunSh);
        break;
      case 'tank':
        s.orect(d.x - 30, d.y - 90, 60, 90, C.rust);
        s.rect(d.x - 30, d.y - 90, 8, 90, C.fire3);
        for (let y = d.y - 80; y < d.y; y += 16) s.rect(d.x - 30, y, 60, 1, C.rustSh);
        drawText(s, 'SALTBONE', d.x, d.y - 60, C.offwhite, { align: 'center', outline: null });
        drawText(s, 'CANNERY', d.x, d.y - 50, C.offwhite, { align: 'center', outline: null });
        break;
      case 'bollard':
        s.orect(d.x - 4, d.y - 8, 8, 8, C.gunSh);
        s.orect(d.x - 5, d.y - 10, 10, 3, C.gun);
        break;
    }
  }

  private groundSand(s: Surface, so: Solid) {
    const x0 = Math.max(so.x, s.ox - 2), x1 = Math.min(so.x + so.w, s.ox + W + 2);
    s.rect(x0, so.y, x1 - x0, so.h, C.sand);
    s.rect(x0, so.y, x1 - x0, 1, C.offwhite);
    s.rect(x0, so.y + 1, x1 - x0, 1, mix(C.sand, C.offwhite, 0.5));
    for (let x = Math.floor(x0); x < x1; x++) {
      const h = hash(x);
      if (h < 0.18) s.pset(x, so.y + 3 + Math.floor(h * 60) % 28, C.sandSh);
      if (h > 0.97) { s.pset(x, so.y + 6 + Math.floor(h * 100) % 20, C.offwhite); s.pset(x + 1, so.y + 6 + Math.floor(h * 100) % 20, C.red); }
      if (h > 0.5 && h < 0.53) s.pset(x, so.y + 12 + Math.floor(h * 400) % 16, C.sandDk);
    }
    s.drect(x0, so.y + 18, x1 - x0, so.h, C.sandSh, 0.5);
    if (so.y < GROUND) { s.rect(so.x - 1, so.y, 1, GROUND - so.y, C.sandSh); s.rect(so.x + so.w, so.y, 1, GROUND - so.y, C.sandSh); }
  }

  private groundCobble(s: Surface, so: Solid) {
    const x0 = Math.max(so.x, s.ox - 8), x1 = Math.min(so.x + so.w, s.ox + W + 8);
    s.rect(x0, so.y, x1 - x0, so.h, C.stoneSh);
    s.rect(x0, so.y, x1 - x0, 3, C.stone);
    s.rect(x0, so.y + 3, x1 - x0, 1, C.stoneDk);
    for (let row = 0; row < 6; row++) {
      const y = so.y + 5 + row * 5;
      const off = row % 2 ? 4 : 0;
      for (let x = Math.floor((x0 - off) / 8) * 8 + off; x < x1; x += 8) {
        s.rect(x + 1, y, 6, 3, row < 2 ? C.stone : C.stoneSh);
        s.pset(x + 1, y, C.plaster);
        s.rect(x + 1, y + 3, 6, 1, C.stoneDk);
      }
    }
  }

  private groundConcrete(s: Surface, so: Solid) {
    const x0 = Math.max(so.x, s.ox - 8), x1 = Math.min(so.x + so.w, s.ox + W + 8);
    s.orect(x0, so.y, x1 - x0, so.h, C.stone);
    s.rect(x0, so.y, x1 - x0, 2, C.plaster);
    s.rect(x0, so.y + 2, x1 - x0, 2, C.yellow);
    for (let x = Math.floor(x0 / 24) * 24; x < x1; x += 24) s.rect(x, so.y + 4, 1, so.h, C.stoneSh);
  }

  private groundPier(g: Game, s: Surface, so: Solid) {
    const x0 = Math.max(so.x, s.ox - 8), x1 = Math.min(so.x + so.w, s.ox + W + 8);
    s.rect(x0, so.y, x1 - x0, 6, C.wood);
    s.rect(x0, so.y, x1 - x0, 1, C.woodHi);
    s.rect(x0, so.y + 6, x1 - x0, 2, C.woodSh);
    for (let x = Math.floor(x0 / 10) * 10; x < x1; x += 10) s.rect(x, so.y + 1, 1, 5, C.woodSh);
    // pilings into the water
    for (let x = Math.floor(x0 / 40) * 40; x < x1; x += 40) {
      s.orect(x + 4, so.y + 8, 6, 30, C.woodSh);
      s.rect(x + 4, so.y + 8, 2, 30, C.wood);
    }
    // water under the pier
    const wy = so.y + 18;
    for (let y = wy; y < H + s.oy; y++) for (let x = Math.floor(x0); x < x1; x++) {
      if (s.pget(x, y) === 0 || true) {
        const k = (y - wy) / 20;
        if (bayer(x, y) < 0.35 - k * 0.2 && ((x + g.t) >> 3) % 3 === 0) s.pset(x, y, hex('#3a6878'));
      }
    }
  }

  private groundRail(g: Game, s: Surface, so: Solid) {
    const x0 = Math.max(so.x, s.ox - 8), x1 = Math.min(so.x + so.w, s.ox + W + 8);
    const sc = Math.floor(this.rail.scroll);
    const fast = this.rail.speed > 2;
    s.rect(x0, so.y, x1 - x0, so.h, hex('#6a6060'));
    for (let x = Math.floor(x0); x < x1; x++) {
      const h = hash(x + sc);
      const yy = so.y + 4 + (Math.floor(h * 90) % 12);
      if (h < 0.3) fast ? s.hline(x, x + 6, yy, hex('#8a8078')) : s.pset(x, yy, hex('#8a8078'));
      if (h > 0.85) s.pset(x, so.y + 4 + (Math.floor(h * 70) % 12), hex('#4a4040'));
    }
    const o = sc % 14;
    for (let x = Math.floor(x0 / 14) * 14 - o; x < x1; x += 14) s.orect(x, so.y + 1, 8, 3, C.woodSh);
    s.rect(x0, so.y - 1, x1 - x0, 2, C.steelHi);
    s.rect(x0, so.y + 1, x1 - x0, 1, C.steelSh);
    void g;
  }

  private drawFlatcar(g: Game, s: Surface, so: Solid) {
    const x0 = so.x, x1 = so.x + so.w, y = so.y;
    const shake = this.rail.speed > 1 && ((g.t >> 2) & 1) ? 1 : 0;
    // bogies + wheels (spin with speed)
    const a = this.rail.scroll * 0.18;
    for (const bx of [x0 + 52, x0 + so.w - 90]) {
      s.orect(bx - 20, y + 14, 40, 6, C.gunSh);
      for (const wx of [bx - 11, bx + 11]) {
        s.odisc(wx, RAIL_Y - 6, 6, C.gunSh);
        s.disc(wx, RAIL_Y - 6, 3, C.steel);
        s.line(wx - Math.cos(a) * 5, RAIL_Y - 6 - Math.sin(a) * 5, wx + Math.cos(a) * 5, RAIL_Y - 6 + Math.sin(a) * 5, C.steelHi);
        s.pset(wx, RAIL_Y - 6, C.white);
      }
    }
    // coupler
    s.orect(x0 - 8, y + 9, 10, 3, C.gunSh);
    // deck planks + side beam
    s.orect(x0, y + shake, so.w, 4, C.wood);
    s.rect(x0, y + shake, so.w, 1, C.woodHi);
    for (let x = x0 + ((this.rail.on ? 0 : 0)); x < x1; x += 12) s.rect(x, y + 1 + shake, 1, 3, C.woodSh);
    s.orect(x0, y + 4 + shake, so.w, 9, C.rust);
    s.rect(x0, y + 4 + shake, so.w, 1, C.fire3);
    s.rect(x0, y + 11 + shake, so.w, 2, C.rustSh);
    for (let x = x0 + 4; x < x1; x += 14) s.pset(x, y + 7 + shake, C.tinHi);
    drawText(s, 'SALTBONE RAIL 07', x0 + 150, y + 5 + shake, C.offwhite, { outline: null });
    // rear railing post (the barrier)
    if (this.barrier?.alive) {
      s.othick(x0 + 1, y - 22, x0 + 1, y, 1, C.steelSh);
      s.othick(x0 + 1, y - 22, x0 + 14, y - 16, 1, C.redSh);
    }
  }

  // title background: dawn beach with the harbour behind
  drawTitleBack(g: Game, s: Surface) {
    // the far layers drift slowly; the foreground stays put in screen space. Drawing the palms
    // with a fractional camera offset made every trunk/frond segment round differently each
    // frame, which read as the trees shaking.
    const cx = g.t * 0.3;
    this.backBeach(g, s, cx, 0);
    s.ox = 0; s.oy = 0;
    s.rect(0, GROUND, W, 40, C.sand);
    s.rect(0, GROUND, W, 1, C.offwhite);
    palm(s, 40, GROUND, 90, g.t, 8, 1);
    palm(s, 340, GROUND, 80, g.t, -8, 2);
  }
}

function blend(dst: Surface, src: Surface, k: number) {
  const d = dst.px, sp = src.px, w = dst.w;
  for (let y = 0; y < dst.h; y++)
    for (let x = 0; x < w; x++) if (bayer(x, y) < k) d[y * w + x] = sp[y * w + x];
}
