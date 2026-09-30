// All sound effects are synthesized at startup; music is a tiny step sequencer; voice lines are
// pre-rendered TTS samples (Fish Audio) loaded from /voice.

type SynthFn = (sr: number, r: () => number) => Float32Array;

let seed = 1234567;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;
const TAU = Math.PI * 2;

function arr(sr: number, dur: number) {
  return new Float32Array(Math.ceil(sr * dur));
}

function drive(a: Float32Array, k: number, gain = 1) {
  const n = Math.tanh(k);
  for (let i = 0; i < a.length; i++) a[i] = (Math.tanh(a[i] * k) / n) * gain;
  return a;
}

function fadeEdges(a: Float32Array, sr: number, fin = 0.002, fout = 0.01) {
  const ni = Math.floor(fin * sr), no = Math.floor(fout * sr);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

// Generic "noise through a sweeping one-pole lowpass + pitched body" voice.
function boom(sr: number, dur: number, o: { k0: number; k1: number; decay: number; sub0: number; sub1: number; subAmp: number; subDecay: number; crackle?: number; drive?: number; gain?: number }) {
  const a = arr(sr, dur);
  let y = 0, y2 = 0, ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const p = t / dur;
    const k = o.k0 * Math.pow(o.k1 / o.k0, p);
    y += (noise() - y) * k;
    y2 += (y - y2) * Math.min(1, k * 1.5);
    const f = o.sub0 * Math.pow(o.sub1 / o.sub0, Math.min(1, t / (dur * 0.5)));
    ph += (TAU * f) / sr;
    let s = y2 * 2.2 * Math.exp(-t * o.decay) + Math.sin(ph) * o.subAmp * Math.exp(-t * o.subDecay);
    if (o.crackle && rnd() < o.crackle * Math.exp(-t * 3)) s += noise() * 0.9;
    a[i] = s;
  }
  drive(a, o.drive ?? 1.5, o.gain ?? 0.9);
  return fadeEdges(a, sr, 0.001, 0.05);
}

function tone(sr: number, dur: number, f0: number, f1: number, decay: number, wave: 'sine' | 'square' | 'saw' | 'tri' = 'sine', gain = 0.5) {
  const a = arr(sr, dur);
  let ph = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const f = f0 * Math.pow(f1 / f0, t / dur);
    ph += f / sr;
    const x = ph % 1;
    let s = 0;
    if (wave === 'sine') s = Math.sin(x * TAU);
    else if (wave === 'square') s = x < 0.5 ? 1 : -1;
    else if (wave === 'saw') s = x * 2 - 1;
    else s = 1 - 4 * Math.abs(x - 0.5);
    a[i] = s * Math.exp(-t * decay) * gain;
  }
  return fadeEdges(a, sr);
}

function addInto(dst: Float32Array, src: Float32Array, at = 0, g = 1) {
  for (let i = 0; i < src.length && i + at < dst.length; i++) dst[i + at] += src[i] * g;
  return dst;
}

function bandNoise(sr: number, dur: number, kLo0: number, kLo1: number, kHi: number, env: (t: number) => number) {
  const a = arr(sr, dur);
  let lo = 0, hi = 0;
  for (let i = 0; i < a.length; i++) {
    const t = i / sr;
    const k = kLo0 * Math.pow(kLo1 / kLo0, t / dur);
    const n = noise();
    lo += (n - lo) * k;
    hi += (lo - hi) * kHi;
    a[i] = (lo - hi) * env(t) * 3;
  }
  return fadeEdges(a, sr);
}

function arp(sr: number, notes: number[], stepDur: number, wave: 'square' | 'tri' = 'square', gain = 0.25) {
  const a = arr(sr, stepDur * notes.length + 0.15);
  notes.forEach((m, i) => {
    const f = 440 * Math.pow(2, (m - 69) / 12);
    addInto(a, tone(sr, stepDur + 0.12, f, f, 9, wave, gain), Math.floor(i * stepDur * sr));
  });
  return a;
}

function loopify(a: Float32Array, sr: number, xf = 0.08) {
  const n = Math.floor(xf * sr);
  const out = a.slice(0, a.length - n);
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = out[i] * t + a[a.length - n + i] * (1 - t);
  }
  return out;
}

const SYNTHS: Record<string, SynthFn> = {
  pistol: (sr) => {
    const a = boom(sr, 0.14, { k0: 0.7, k1: 0.08, decay: 38, sub0: 900, sub1: 160, subAmp: 0.55, subDecay: 45, drive: 2.2, gain: 0.8 });
    return a;
  },
  gat: (sr) => boom(sr, 0.12, { k0: 0.8, k1: 0.12, decay: 42, sub0: 520, sub1: 90, subAmp: 0.9, subDecay: 40, drive: 2.6, gain: 0.85 }),
  scatter: (sr) => boom(sr, 0.5, { k0: 0.6, k1: 0.02, decay: 8, sub0: 140, sub1: 45, subAmp: 1.1, subDecay: 12, crackle: 0.01, drive: 3, gain: 1 }),
  rocket: (sr) => {
    const a = bandNoise(sr, 0.55, 0.05, 0.5, 0.02, (t) => Math.min(1, t * 30) * Math.exp(-t * 5));
    addInto(a, boom(sr, 0.12, { k0: 0.5, k1: 0.1, decay: 30, sub0: 300, sub1: 80, subAmp: 0.8, subDecay: 30 }), 0, 0.8);
    return drive(a, 1.5, 0.8);
  },
  flame: (sr) => {
    const a = arr(sr, 1.1);
    let y = 0, y2 = 0;
    for (let i = 0; i < a.length; i++) {
      y += (noise() - y) * 0.2;
      y2 += (y - y2) * 0.05;
      let s = (y - y2) * 1.8 + y2 * 1.5;
      if (rnd() < 0.002) s += noise() * 1.2;
      a[i] = s * (0.8 + 0.2 * Math.sin((i / sr) * TAU * 7));
    }
    return loopify(drive(a, 1.4, 0.6), sr);
  },
  expl_s: (sr) => boom(sr, 0.7, { k0: 0.45, k1: 0.015, decay: 6, sub0: 110, sub1: 38, subAmp: 1, subDecay: 9, crackle: 0.02, drive: 2.4, gain: 0.95 }),
  expl_m: (sr) => boom(sr, 1.3, { k0: 0.4, k1: 0.01, decay: 3.4, sub0: 80, sub1: 28, subAmp: 1.2, subDecay: 5, crackle: 0.03, drive: 2.8, gain: 1 }),
  expl_l: (sr) => {
    const a = boom(sr, 2.6, { k0: 0.35, k1: 0.006, decay: 1.6, sub0: 60, sub1: 22, subAmp: 1.3, subDecay: 2.2, crackle: 0.04, drive: 3.2, gain: 1 });
    return a;
  },
  hit: (sr) => {
    const a = tone(sr, 0.09, 260, 70, 40, 'sine', 0.9);
    addInto(a, bandNoise(sr, 0.03, 0.6, 0.3, 0.1, (t) => Math.exp(-t * 90)), 0, 0.7);
    return drive(a, 2, 0.8);
  },
  hitheavy: (sr) => {
    const a = tone(sr, 0.16, 180, 50, 24, 'sine', 1);
    addInto(a, boom(sr, 0.1, { k0: 0.5, k1: 0.1, decay: 40, sub0: 200, sub1: 100, subAmp: 0.4, subDecay: 40 }), 0, 0.8);
    return drive(a, 2.5, 0.85);
  },
  ping: (sr) => {
    const a = tone(sr, 0.35, 2600, 2300, 14, 'sine', 0.35);
    addInto(a, tone(sr, 0.3, 3900, 3500, 18, 'sine', 0.22));
    addInto(a, bandNoise(sr, 0.02, 0.9, 0.9, 0.3, (t) => Math.exp(-t * 200)), 0, 0.6);
    return a;
  },
  clank: (sr) => {
    const a = tone(sr, 0.3, 620, 560, 18, 'sine', 0.4);
    addInto(a, tone(sr, 0.25, 1470, 1400, 22, 'sine', 0.3));
    addInto(a, tone(sr, 0.2, 2210, 2100, 28, 'sine', 0.2));
    addInto(a, boom(sr, 0.08, { k0: 0.8, k1: 0.3, decay: 60, sub0: 300, sub1: 150, subAmp: 0.3, subDecay: 50 }), 0, 0.7);
    return drive(a, 1.6, 0.8);
  },
  sand: (sr) => bandNoise(sr, 0.12, 0.2, 0.05, 0.01, (t) => Math.exp(-t * 35)),
  wood: (sr) => {
    const a = arr(sr, 0.45);
    for (let k = 0; k < 6; k++) {
      const f = 250 + rnd() * 350;
      addInto(a, tone(sr, 0.08, f, f * 0.8, 50, 'tri', 0.5), Math.floor(rnd() * 0.25 * sr));
    }
    addInto(a, bandNoise(sr, 0.4, 0.3, 0.05, 0.02, (t) => Math.exp(-t * 9)), 0, 0.8);
    return drive(a, 1.5, 0.8);
  },
  glass: (sr) => {
    const a = arr(sr, 0.6);
    for (let k = 0; k < 14; k++) {
      const f = 2800 + rnd() * 4000;
      addInto(a, tone(sr, 0.12, f, f, 35, 'sine', 0.18), Math.floor(Math.pow(rnd(), 1.5) * 0.4 * sr));
    }
    addInto(a, bandNoise(sr, 0.1, 0.9, 0.9, 0.4, (t) => Math.exp(-t * 60)), 0, 0.6);
    return a;
  },
  tonk: (sr) => tone(sr, 0.09, 720, 420, 40, 'tri', 0.6),
  throw: (sr) => bandNoise(sr, 0.18, 0.1, 0.6, 0.05, (t) => Math.sin(Math.min(1, t / 0.18) * Math.PI)),
  pickup: (sr) => arp(sr, [72, 76, 79, 84], 0.045),
  weapon: (sr) => arp(sr, [67, 71, 74, 79, 83, 86], 0.05, 'square', 0.3),
  bombs: (sr) => arp(sr, [60, 67, 72], 0.05, 'tri', 0.4),
  jump: (sr) => bandNoise(sr, 0.12, 0.05, 0.3, 0.02, (t) => Math.exp(-t * 25)),
  land: (sr) => {
    const a = bandNoise(sr, 0.09, 0.15, 0.03, 0.005, (t) => Math.exp(-t * 45));
    addInto(a, tone(sr, 0.06, 120, 60, 50, 'sine', 0.5));
    return a;
  },
  slide: (sr) => bandNoise(sr, 0.32, 0.4, 0.15, 0.08, (t) => Math.min(1, t * 40) * Math.exp(-t * 7)),
  slash: (sr) => {
    const a = bandNoise(sr, 0.16, 0.2, 0.9, 0.2, (t) => Math.sin(Math.min(1, t / 0.16) * Math.PI));
    addInto(a, tone(sr, 0.2, 3400, 3000, 20, 'sine', 0.15), Math.floor(0.03 * sr));
    return a;
  },
  alert: (sr) => {
    const a = tone(sr, 0.06, 900, 900, 10, 'square', 0.18);
    addInto(a, tone(sr, 0.08, 1350, 1350, 10, 'square', 0.18), Math.floor(0.06 * sr));
    return a;
  },
  blip: (sr) => tone(sr, 0.06, 990, 990, 20, 'square', 0.2),
  select: (sr) => arp(sr, [76, 83, 88], 0.04, 'square', 0.25),
  siren: (sr) => {
    const a = arr(sr, 1.5);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const f = 560 + 340 * (0.5 - 0.5 * Math.cos(t * TAU * 1.3));
      ph += f / sr;
      a[i] = ((ph % 1) * 2 - 1) * 0.25 * Math.min(1, t * 20) * Math.min(1, (1.5 - t) * 8);
    }
    return a;
  },
  roar: (sr) => {
    const a = arr(sr, 1.4);
    let ph = 0, ph2 = 0, y = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const f = 70 + 30 * Math.sin(t * 9) - t * 20;
      ph += f / sr;
      ph2 += (f * 1.51) / sr;
      y += (noise() - y) * 0.08;
      const env = Math.min(1, t * 8) * Math.exp(-t * 1.6);
      a[i] = (((ph % 1) * 2 - 1) * 0.6 + ((ph2 % 1) * 2 - 1) * 0.4 + y * 1.5) * env;
    }
    return drive(a, 3, 0.8);
  },
  steam: (sr) => bandNoise(sr, 0.7, 0.9, 0.7, 0.35, (t) => Math.min(1, t * 30) * Math.exp(-t * 3.5)),
  heli: (sr) => {
    const a = arr(sr, 1.0);
    let y = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      y += (noise() - y) * 0.12;
      const chop = Math.pow(0.5 + 0.5 * Math.sin(t * TAU * 16), 3);
      a[i] = y * 2.2 * (0.25 + chop) + Math.sin(t * TAU * 48) * 0.1 * chop;
    }
    return a;
  },
  train: (sr) => {
    const a = arr(sr, 1.0);
    let y = 0;
    for (let i = 0; i < a.length; i++) {
      y += (noise() - y) * 0.03;
      a[i] = y * 1.2;
    }
    for (const at of [0.0, 0.11, 0.5, 0.61]) {
      addInto(a, boom(sr, 0.1, { k0: 0.6, k1: 0.2, decay: 50, sub0: 260, sub1: 140, subAmp: 0.4, subDecay: 45 }), Math.floor(at * sr), 0.8);
    }
    return a;
  },
  splash: (sr) => {
    const a = boom(sr, 1.0, { k0: 0.5, k1: 0.04, decay: 4, sub0: 90, sub1: 40, subAmp: 0.4, subDecay: 8, drive: 1.2, gain: 0.8 });
    for (let k = 0; k < 10; k++) {
      const f = 500 + rnd() * 900;
      addInto(a, tone(sr, 0.07, f, f * 1.8, 30, 'sine', 0.15), Math.floor((0.1 + rnd() * 0.6) * sr));
    }
    return a;
  },
  step: (sr) => bandNoise(sr, 0.035, 0.3, 0.1, 0.03, (t) => Math.exp(-t * 120)),
  shell: (sr) => tone(sr, 0.05, 4600 + rnd() * 800, 4200, 60, 'sine', 0.12),
  charge: (sr) => {
    const a = tone(sr, 0.9, 200, 1400, 0.5, 'saw', 0.18);
    for (let i = 0; i < a.length; i++) a[i] *= Math.min(1, i / (0.7 * sr));
    return a;
  },
  laser: (sr) => {
    const a = arr(sr, 0.8);
    let ph = 0;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const f = 180 + 30 * Math.sin(t * TAU * 30);
      ph += f / sr;
      a[i] = ((ph % 1) * 2 - 1) * 0.35 * Math.min(1, t * 50) * Math.min(1, (0.8 - t) * 10) + noise() * 0.08;
    }
    return drive(a, 2, 0.7);
  },
  whistle: (sr) => tone(sr, 0.8, 1700, 600, 0.3, 'sine', 0.12),
  slam: (sr) => boom(sr, 1.2, { k0: 0.3, k1: 0.01, decay: 3, sub0: 55, sub1: 25, subAmp: 1.6, subDecay: 3.5, crackle: 0.03, drive: 3.5, gain: 1 }),
  thoomp: (sr) => boom(sr, 0.35, { k0: 0.3, k1: 0.05, decay: 14, sub0: 160, sub1: 60, subAmp: 1.1, subDecay: 14, drive: 2, gain: 0.8 }),
  crumble: (sr) => {
    const a = bandNoise(sr, 1.2, 0.12, 0.02, 0.004, (t) => Math.min(1, t * 10) * Math.exp(-t * 2.5));
    for (let k = 0; k < 16; k++) {
      const f = 90 + rnd() * 200;
      addInto(a, tone(sr, 0.12, f, f * 0.7, 30, 'tri', 0.5), Math.floor(rnd() * 0.9 * sr));
    }
    return drive(a, 2, 0.9);
  },
  score: (sr) => arp(sr, [84, 91], 0.04, 'square', 0.18),
  tick: (sr) => tone(sr, 0.03, 1800, 1800, 60, 'square', 0.12),
  beep: (sr) => tone(sr, 0.12, 880, 880, 6, 'square', 0.2),
  rescue: (sr) => arp(sr, [72, 76, 79, 84, 88], 0.06, 'tri', 0.35),
  scream: (sr) => {
    // comedic synthesized "WAAAH" (fallback when no recorded scream is available)
    const a = arr(sr, 0.55);
    let ph = 0, y = 0;
    const base = 260 + rnd() * 160;
    for (let i = 0; i < a.length; i++) {
      const t = i / sr;
      const f = base * (1 + 0.25 * Math.sin(t * 40)) * (1 - t * 0.6);
      ph += f / sr;
      const saw = (ph % 1) * 2 - 1;
      y += (saw - y) * 0.25;
      a[i] = y * Math.min(1, t * 30) * Math.min(1, (0.55 - t) * 8) * 0.5;
    }
    return drive(a, 2, 0.6);
  },
  kick: (sr) => {
    const a = tone(sr, 0.22, 160, 42, 12, 'sine', 1);
    return drive(a, 2, 0.9);
  },
  snare: (sr) => {
    const a = bandNoise(sr, 0.18, 0.6, 0.4, 0.08, (t) => Math.exp(-t * 22));
    addInto(a, tone(sr, 0.1, 210, 160, 30, 'tri', 0.6));
    return drive(a, 1.8, 0.8);
  },
  hat: (sr) => bandNoise(sr, 0.04, 0.95, 0.95, 0.6, (t) => Math.exp(-t * 110)),
  ohat: (sr) => bandNoise(sr, 0.2, 0.95, 0.95, 0.6, (t) => Math.exp(-t * 16)),
  crash: (sr) => bandNoise(sr, 1.2, 0.95, 0.9, 0.5, (t) => Math.exp(-t * 3.5)),
  tom: (sr) => drive(tone(sr, 0.25, 180, 90, 14, 'sine', 0.9), 1.5, 0.8),
};

const VARIANTS: Record<string, number> = { pistol: 3, gat: 3, hit: 3, ping: 2, expl_s: 3, expl_m: 2, wood: 2, glass: 2, step: 3, shell: 3, scream: 4, clank: 2 };

interface PlayOpts {
  vol?: number;
  pitch?: number; // playback rate multiplier
  vary?: number; // random pitch variation fraction
  pan?: number;
  bus?: 'sfx' | 'music' | 'voice';
  delay?: number;
}

// ---------------------------------------------------------------- Music

export interface Song {
  bpm: number;
  // Each part is a sequence of bars; each bar is a string of tokens "note:len" (len in 16ths).
  lead?: string[];
  harm?: string[];
  bass?: string[];
  drum?: string[];
  loop?: boolean;
  leadWave?: 'square' | 'saw' | 'tri';
  leadVol?: number;
}

const NOTE_IDX: Record<string, number> = { C: 0, 'C#': 1, D: 2, 'D#': 3, E: 4, F: 5, 'F#': 6, G: 7, 'G#': 8, A: 9, 'A#': 10, B: 11 };
function midiOf(n: string): number {
  const m = /^([A-G]#?)(-?\d)$/.exec(n);
  if (!m) return -1;
  return NOTE_IDX[m[1]] + (parseInt(m[2]) + 1) * 12;
}

interface Ev { step: number; len: number; midi: number; drum?: string }

function parsePart(bars: string[] | undefined, isDrum: boolean): { evs: Ev[]; len: number } {
  const evs: Ev[] = [];
  let step = 0;
  for (const bar of bars ?? []) {
    for (const tok of bar.trim().split(/\s+/)) {
      if (!tok) continue;
      const [n, l] = tok.split(':');
      const len = l ? parseInt(l) : 1;
      if (isDrum) {
        if (n !== '.' && n !== 'r') evs.push({ step, len, midi: 0, drum: n });
      } else if (n !== 'r' && n !== '.') {
        evs.push({ step, len, midi: midiOf(n) });
      }
      step += len;
    }
  }
  return { evs, len: step };
}

export class AudioSys {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses: Record<string, GainNode> = {};
  private bank = new Map<string, AudioBuffer[]>();
  private active = new Map<string, number[]>(); // end times of currently playing instances
  private loops = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();
  private voiceBufs = new Map<string, AudioBuffer[]>();
  private lastVoiceEnd = 0;
  muted = false;
  enabled = true;

  // music state
  private song: Song | null = null;
  private parts: { lead: Ev[]; harm: Ev[]; bass: Ev[]; drum: Ev[]; len: number } | null = null;
  private songStart = 0;
  private schedStep = 0;
  private musicGain!: GainNode;
  private pulse: PeriodicWave | null = null;
  private duck = 1;

  init() {
    if (this.ctx || !this.enabled) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 8;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);
    for (const b of ['sfx', 'music', 'voice']) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[b] = g;
    }
    this.buses.sfx.gain.value = 0.75;
    this.buses.music.gain.value = 0.55;
    this.buses.voice.gain.value = 1.0;
    this.musicGain = this.buses.music;
    const sr = ctx.sampleRate;
    for (const name of Object.keys(SYNTHS)) {
      const n = VARIANTS[name] ?? 1;
      const list: AudioBuffer[] = [];
      for (let v = 0; v < n; v++) {
        const data = SYNTHS[name](sr, rnd);
        const b = ctx.createBuffer(1, data.length, sr);
        b.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
        list.push(b);
      }
      this.bank.set(name, list);
    }
    // 25% pulse wave for the lead
    const N = 32;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let k = 1; k < N; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
    this.pulse = ctx.createPeriodicWave(re, im);
    if (ctx.state === 'suspended') ctx.resume();
  }

  async loadVoices(names: string[], base: string) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    await Promise.all(
      names.map(async (n) => {
        try {
          const res = await fetch(`${base}${n}.mp3`);
          if (!res.ok) return;
          const ab = await res.arrayBuffer();
          const buf = await ctx.decodeAudioData(ab);
          const key = n.replace(/_\d+$/, '');
          const list = this.voiceBufs.get(key) ?? [];
          list.push(buf);
          this.voiceBufs.set(key, list);
        } catch {
          /* missing voice files are fine: game falls back to synth sounds */
        }
      }),
    );
  }

  hasVoice(key: string) {
    return this.voiceBufs.has(key);
  }

  play(name: string, o: PlayOpts = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const list = this.bank.get(name);
    if (!list) return;
    const now = ctx.currentTime + (o.delay ?? 0);
    // voice limiting per sound
    const ends = (this.active.get(name) ?? []).filter((t) => t > ctx.currentTime);
    const limit = name.startsWith('expl') ? 4 : 5;
    if (ends.length >= limit) return;
    const buf = list[Math.floor(Math.random() * list.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const vary = o.vary ?? 0.06;
    const rate = (o.pitch ?? 1) * (1 + (Math.random() * 2 - 1) * vary);
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = (o.vol ?? 1) * (1 - Math.random() * 0.12);
    let node: AudioNode = g;
    if (o.pan !== undefined && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, o.pan));
      g.connect(p);
      node = p;
    }
    src.connect(g);
    node.connect(this.buses[o.bus ?? 'sfx']);
    src.start(now);
    ends.push(now + buf.duration / rate);
    this.active.set(name, ends);
  }

  voice(key: string, o: { vol?: number; fallback?: string; priority?: boolean; pitch?: number } = {}) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const list = this.voiceBufs.get(key);
    if (!list) {
      if (o.fallback) this.play(o.fallback, { vol: o.vol ?? 1 });
      return;
    }
    // at most two overlapping copies of the same line (keeps crowd deaths readable)
    const ends = (this.active.get('v:' + key) ?? []).filter((t) => t > ctx.currentTime);
    if (ends.length >= (o.priority ? 1 : 2)) return;
    const buf = list[Math.floor(Math.random() * list.length)];
    ends.push(ctx.currentTime + buf.duration / (o.pitch ?? 1));
    this.active.set('v:' + key, ends);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = o.pitch ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.vol ?? 1;
    src.connect(g).connect(this.buses.voice);
    src.start();
    if (o.priority) {
      // duck music under announcer lines
      const end = ctx.currentTime + buf.duration;
      this.lastVoiceEnd = Math.max(this.lastVoiceEnd, end);
      this.musicGain.gain.cancelScheduledValues(ctx.currentTime);
      this.musicGain.gain.setTargetAtTime(0.55 * 0.45, ctx.currentTime, 0.03);
      this.musicGain.gain.setTargetAtTime(0.55, end, 0.2);
    }
  }

  loop(name: string, vol: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    let l = this.loops.get(name);
    if (!l) {
      const list = this.bank.get(name);
      if (!list) return;
      const src = ctx.createBufferSource();
      src.buffer = list[0];
      src.loop = true;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(gain).connect(this.buses.sfx);
      src.start();
      l = { src, gain };
      this.loops.set(name, l);
    }
    l.gain.gain.setTargetAtTime(this.muted ? 0 : vol, ctx.currentTime, 0.04);
  }

  stopLoops() {
    for (const [, l] of this.loops) {
      try { l.src.stop(); } catch { /* already stopped */ }
    }
    this.loops.clear();
  }

  // ------------------------------------------------------------ music
  playSong(song: Song | null) {
    const ctx = this.ctx;
    this.song = song;
    if (!ctx || !song) { this.parts = null; return; }
    const lead = parsePart(song.lead, false), harm = parsePart(song.harm, false), bass = parsePart(song.bass, false), drum = parsePart(song.drum, true);
    this.parts = { lead: lead.evs, harm: harm.evs, bass: bass.evs, drum: drum.evs, len: Math.max(lead.len, harm.len, bass.len, drum.len) };
    this.songStart = ctx.currentTime + 0.08;
    this.schedStep = 0;
  }

  get songName() { return this.song; }

  update() {
    const ctx = this.ctx;
    if (!ctx || !this.song || !this.parts) return;
    const spb = 60 / this.song.bpm / 4; // seconds per 16th
    const horizon = ctx.currentTime + 0.15;
    const P = this.parts;
    while (this.songStart + this.schedStep * spb < horizon) {
      const step = this.schedStep;
      const loopStep = P.len > 0 ? step % P.len : 0;
      if (!this.song.loop && step >= P.len) { this.song = null; return; }
      const t = this.songStart + step * spb;
      for (const e of P.drum) if (e.step === loopStep) this.drum(e.drum!, t);
      for (const e of P.bass) if (e.step === loopStep) this.note('bass', e.midi, t, e.len * spb);
      for (const e of P.harm) if (e.step === loopStep) this.note('harm', e.midi, t, e.len * spb);
      for (const e of P.lead) if (e.step === loopStep) this.note('lead', e.midi, t, e.len * spb);
      this.schedStep++;
    }
  }

  private drum(tok: string, t: number) {
    const map: Record<string, [string, number]> = { k: ['kick', 0.9], s: ['snare', 0.6], h: ['hat', 0.25], o: ['ohat', 0.25], c: ['crash', 0.35], t: ['tom', 0.6] };
    for (const ch of tok) {
      const m = map[ch];
      if (!m) continue;
      const ctx = this.ctx!;
      const buf = this.bank.get(m[0])![0];
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const g = ctx.createGain();
      g.gain.value = m[1];
      src.connect(g).connect(this.buses.music);
      src.start(t);
    }
  }

  private note(kind: 'lead' | 'harm' | 'bass', midi: number, t: number, dur: number) {
    const ctx = this.ctx!;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    let out: AudioNode = g;
    if (kind === 'lead') {
      const w = this.song?.leadWave ?? 'square';
      if (w === 'square' && this.pulse) o.setPeriodicWave(this.pulse);
      else o.type = w === 'saw' ? 'sawtooth' : 'triangle';
      const vib = ctx.createOscillator();
      const vg = ctx.createGain();
      vib.frequency.value = 5.5;
      vg.gain.value = f * 0.006;
      vib.connect(vg).connect(o.frequency);
      vib.start(t + 0.12);
      vib.stop(t + dur + 0.1);
      const v = 0.16 * (this.song?.leadVol ?? 1);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(v, t + 0.006);
      g.gain.setTargetAtTime(v * 0.7, t + 0.02, 0.08);
      g.gain.setTargetAtTime(0, t + dur * 0.92, 0.03);
    } else if (kind === 'harm') {
      o.type = 'triangle';
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.1, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.01, 0.06);
    } else {
      o.type = 'sawtooth';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 6;
      lp.frequency.setValueAtTime(1600, t);
      lp.frequency.setTargetAtTime(280, t, 0.06);
      g.connect(lp);
      out = lp;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.3, t + 0.004);
      g.gain.setTargetAtTime(0.18, t + 0.01, 0.1);
      g.gain.setTargetAtTime(0, t + dur * 0.9, 0.02);
    }
    o.frequency.setValueAtTime(f, t);
    o.connect(g);
    out.connect(this.buses.music);
    o.start(t);
    o.stop(t + dur + 0.3);
  }
}

export const audio = new AudioSys();
