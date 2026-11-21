/**
 * Cartoon voice for "our baby", synthesized on the device (no audio files to download).
 * A buzzy source shaped by vowel formants gives "waah", "ha-ha", "ooh" and "mmm" sounds; the
 * pitch drops a little as the child grows up.
 */
export type BabySound =
  | "giggle" | "cry" | "whine" | "coo" | "nom" | "snore" | "sparkle"
  | "tickle" | "sneeze" | "pat" | "hmph" | "yawn" | "cough" | "kiss"
  | "splash" | "squeak" | "coin" | "levelup";

const MUTE_KEY = "circle-baby-sound";
export const babySoundOn = () => {
  try {
    return localStorage.getItem(MUTE_KEY) !== "off";
  } catch {
    return true;
  }
};
export const setBabySoundOn = (on: boolean) => {
  try {
    if (on) localStorage.removeItem(MUTE_KEY);
    else localStorage.setItem(MUTE_KEY, "off");
  } catch {
    /* storage unavailable */
  }
};

/** Voice pitch and vowel size per stage: baby, toddler, child, big kid. */
const PITCH = [1, 0.9, 0.8, 0.72];
const FORMANT = [1.18, 1.1, 1.02, 0.96];

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

function audio() {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  context ??= new Context();
  if (context.state === "suspended") void context.resume();
  return context;
}

function noiseBuffer(ctx: AudioContext) {
  if (noise) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noise;
}

type Syllable = {
  at: number;
  dur: number;
  /** Pitch contour in Hz, spread evenly over the syllable. */
  pitch: number[];
  /** Vowel formants in Hz (first, second). */
  vowel: [number, number];
  gain?: number;
  /** Sobbing wobble in Hz (0 = steady). */
  tremolo?: number;
  vibrato?: number;
  /** Closed mouth: only the low hum passes ("mmm"). */
  hum?: boolean;
  breath?: number;
};

function syllable(ctx: AudioContext, out: AudioNode, t0: number, s: Syllable, pitchScale: number, formantScale: number) {
  const start = t0 + s.at, end = start + s.dur;
  const source = ctx.createOscillator();
  source.type = "sawtooth";
  s.pitch.forEach((hz, i) => {
    const at = start + (s.dur * i) / Math.max(1, s.pitch.length - 1);
    if (i === 0) source.frequency.setValueAtTime(hz * pitchScale, at);
    else source.frequency.linearRampToValueAtTime(hz * pitchScale, at);
  });
  if (s.vibrato) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = 6.5;
    depth.gain.value = s.vibrato * pitchScale;
    lfo.connect(depth).connect(source.frequency);
    lfo.start(start);
    lfo.stop(end + 0.05);
  }
  const envelope = ctx.createGain();
  const peak = s.gain ?? 0.5;
  envelope.gain.setValueAtTime(0.0001, start);
  envelope.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.05, s.dur * 0.25));
  envelope.gain.setValueAtTime(peak, Math.max(start + 0.05, end - Math.min(0.12, s.dur * 0.35)));
  envelope.gain.exponentialRampToValueAtTime(0.0001, end);
  if (s.tremolo) {
    const lfo = ctx.createOscillator(), depth = ctx.createGain();
    lfo.frequency.value = s.tremolo;
    depth.gain.value = peak * 0.35;
    lfo.connect(depth).connect(envelope.gain);
    lfo.start(start);
    lfo.stop(end + 0.05);
  }
  const mix = ctx.createGain();
  mix.gain.value = 1;
  if (s.hum) {
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 520 * formantScale;
    low.Q.value = 4;
    source.connect(low).connect(mix);
  } else {
    for (const [hz, level] of [[s.vowel[0], 1], [s.vowel[1], 0.55]] as const) {
      const band = ctx.createBiquadFilter(), g = ctx.createGain();
      band.type = "bandpass";
      band.frequency.value = hz * formantScale;
      band.Q.value = 7;
      g.gain.value = level * 3.2;
      source.connect(band).connect(g).connect(mix);
    }
  }
  mix.connect(envelope).connect(out);
  source.start(start);
  source.stop(end + 0.05);
  if (s.breath) breath(ctx, out, start, s.dur, s.breath, 2600 * formantScale);
}

function breath(ctx: AudioContext, out: AudioNode, start: number, dur: number, level: number, hz: number, q = 0.8) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const band = ctx.createBiquadFilter(), g = ctx.createGain();
  band.type = "bandpass";
  band.frequency.value = hz;
  band.Q.value = q;
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(level, start + dur * 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(band).connect(g).connect(out);
  src.start(start);
  src.stop(start + dur + 0.05);
}

const A: [number, number] = [950, 1500];
const U: [number, number] = [380, 850];
const E: [number, number] = [520, 1950];

function sequence(kind: BabySound): Syllable[] {
  switch (kind) {
    case "giggle":
      return [0, 1, 2, 3, 4].map((i) => ({
        at: i * 0.13, dur: 0.09, pitch: [700 - i * 30, 640 - i * 30], vowel: A, gain: 0.42 - i * 0.04, breath: 0.05,
      }));
    case "cry":
      return [
        { at: 0, dur: 0.75, pitch: [430, 560, 520, 400], vowel: A, gain: 0.5, tremolo: 6, vibrato: 18 },
        { at: 0.98, dur: 0.85, pitch: [450, 590, 540, 380], vowel: A, gain: 0.55, tremolo: 7, vibrato: 22 },
        { at: 2.05, dur: 0.6, pitch: [420, 520, 360], vowel: A, gain: 0.42, tremolo: 6, vibrato: 16 },
      ];
    case "whine":
      return [
        { at: 0, dur: 0.28, pitch: [470, 430], vowel: E, gain: 0.34, hum: true },
        { at: 0.36, dur: 0.42, pitch: [480, 520, 420], vowel: E, gain: 0.38, vibrato: 10 },
      ];
    case "coo":
      return [{ at: 0, dur: 0.62, pitch: [380, 560, 480], vowel: U, gain: 0.38, vibrato: 8 }];
    case "tickle":
      // Breathless, bubbling laughter: faster and higher than a giggle.
      return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
        at: i * 0.085 + (i > 3 ? 0.06 : 0), dur: 0.065, pitch: [820 - (i % 2) * 70 - i * 12, 760 - i * 12], vowel: i % 3 === 2 ? E : A,
        gain: 0.4 - i * 0.025, breath: 0.07,
      }));
    case "sneeze":
      // "Ah… ah…" building up (the "CHOO" burst is added in playBabySound), then a little giggle.
      return [
        { at: 0, dur: 0.24, pitch: [420, 560], vowel: A, gain: 0.26, breath: 0.05 },
        { at: 0.36, dur: 0.3, pitch: [520, 760], vowel: A, gain: 0.32, breath: 0.07 },
        { at: 0.82, dur: 0.14, pitch: [720, 420], vowel: U, gain: 0.45 },
        { at: 1.25, dur: 0.07, pitch: [640, 600], vowel: E, gain: 0.25, breath: 0.03 },
        { at: 1.37, dur: 0.07, pitch: [600, 560], vowel: E, gain: 0.2, breath: 0.03 },
      ];
    case "pat":
      // A contented "mmm-aah", like being stroked on the head.
      return [
        { at: 0, dur: 0.42, pitch: [340, 400, 380], vowel: U, gain: 0.32, hum: true },
        { at: 0.38, dur: 0.55, pitch: [430, 400, 340], vowel: A, gain: 0.26, vibrato: 5, breath: 0.03 },
      ];
    case "hmph":
      // Annoyed: a short pout through the nose.
      return [
        { at: 0, dur: 0.18, pitch: [320, 250], vowel: U, gain: 0.5, hum: true },
        { at: 0.26, dur: 0.22, pitch: [300, 230], vowel: U, gain: 0.42, hum: true },
      ];
    case "yawn":
      return [
        { at: 0, dur: 1.05, pitch: [520, 430, 330], vowel: A, gain: 0.32, breath: 0.08, vibrato: 4 },
        { at: 1.0, dur: 0.45, pitch: [330, 300], vowel: U, gain: 0.22, hum: true },
      ];
    case "cough":
      return [
        { at: 0, dur: 0.1, pitch: [380, 300], vowel: A, gain: 0.32, breath: 0.12 },
        { at: 0.24, dur: 0.1, pitch: [360, 290], vowel: A, gain: 0.28, breath: 0.1 },
        { at: 0.7, dur: 0.38, pitch: [400, 360, 330], vowel: E, gain: 0.22, hum: true, vibrato: 8 },
      ];
    case "kiss":
      // "Mwah!" then a happy coo.
      return [
        { at: 0, dur: 0.1, pitch: [480, 520], vowel: U, gain: 0.3, hum: true },
        { at: 0.12, dur: 0.14, pitch: [620, 560], vowel: A, gain: 0.36 },
        { at: 0.45, dur: 0.5, pitch: [420, 600, 520], vowel: U, gain: 0.32, vibrato: 7 },
      ];
    case "nom":      return [
        { at: 0, dur: 0.16, pitch: [320, 300], vowel: U, gain: 0.4, hum: true },
        { at: 0.22, dur: 0.16, pitch: [330, 310], vowel: U, gain: 0.4, hum: true },
        { at: 0.5, dur: 0.48, pitch: [360, 470, 420], vowel: U, gain: 0.38, hum: true, vibrato: 6 },
      ];
    default:
      return [];
  }
}

/** A short "blip" whose pitch sweeps from `from` to `to` (bubbles, clicks, bells). */
function blip(ctx: AudioContext, out: AudioNode, at: number, from: number, to: number, dur: number, level: number, type: OscillatorType = "sine") {
  const osc = ctx.createOscillator(), g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + Math.min(0.01, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(g).connect(out);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/** A music-box note: a bright fundamental plus a soft octave, ringing out. */
function chime(ctx: AudioContext, out: AudioNode, at: number, hz: number, level: number, ring = 1.4) {
  for (const [mult, amount, type] of [[1, 1, "sine"], [2, 0.32, "sine"], [3.01, 0.12, "triangle"]] as const) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = hz * mult;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level * amount, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + ring / mult);
    osc.connect(g).connect(out);
    osc.start(at);
    osc.stop(at + ring + 0.05);
  }
}

/** Vowel formants for babbling a word (Turkish and English vowels). */
const VOWELS: Record<string, [number, number]> = {
  a: [1000, 1600], e: [620, 2200], ı: [460, 1500], i: [380, 2600], o: [620, 1000], ö: [520, 1700], u: [420, 900], ü: [400, 1950], y: [400, 2300],
};
const HISS = new Set([..."sşçzfhjcx"]);
const HUM = new Set([..."mnl"]);

/**
 * Babbles a word in the baby's voice: one syllable per vowel with the word's own vowel sounds,
 * a hiss for s/ş/ç/f and a hum for m/n, ending on a proud little upward lilt. Returns its length
 * in seconds.
 */
export function sayWord(word: string, stage = 2) {
  if (!babySoundOn()) return 0;
  const ctx = audio();
  if (!ctx) return 0;
  try {
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
    const i = Math.min(3, Math.max(0, stage - 1));
    const letters = [...word.toLocaleLowerCase("tr")].slice(0, 24);
    const vowels = letters.filter((c) => VOWELS[c]).length || 1;
    let at = ctx.currentTime + 0.03;
    let n = 0;
    let onset: "hiss" | "hum" | null = null;
    for (const c of letters) {
      if (c === " ") { at += 0.12; continue; }
      if (HISS.has(c)) { onset = "hiss"; continue; }
      if (HUM.has(c)) { onset = "hum"; continue; }
      const vowel = VOWELS[c];
      if (!vowel) { at += 0.035; continue; }
      if (onset === "hiss") { breath(ctx, out, at, 0.09, 0.09, 4200, 1.4); at += 0.07; }
      if (onset === "hum") {
        syllable(ctx, out, at, { at: 0, dur: 0.08, pitch: [460, 470], vowel: U, gain: 0.3, hum: true }, PITCH[i], FORMANT[i]);
        at += 0.06;
      }
      onset = null;
      const last = n === vowels - 1;
      const base = 470 + Math.sin((n / Math.max(1, vowels - 1)) * Math.PI) * 60;
      const pitch = last ? [base, base + 140, base + 90] : [base + 20, base];
      const dur = last ? 0.3 : 0.17;
      syllable(ctx, out, at, { at: 0, dur, pitch, vowel, gain: 0.42, vibrato: last ? 7 : 0 }, PITCH[i], FORMANT[i]);
      at += dur + 0.05;
      n++;
    }
    return at - ctx.currentTime;
  } catch {
    return 0;
  }
}

let lullaby: GainNode | null = null;

/** "Twinkle, Twinkle, Little Star" (a traditional tune) on a music box, for bedtime. */
export function playLullaby() {
  if (!babySoundOn()) return;
  const ctx = audio();
  if (!ctx) return;
  stopLullaby();
  try {
    const out = ctx.createGain();
    out.gain.value = 0.32;
    out.connect(ctx.destination);
    lullaby = out;
    const C = 1047, D = 1175, E = 1319, F = 1397, G = 1568, A = 1760;
    const tune: [number, number][] = [
      [C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2],
      [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2],
      [G, 1], [G, 1], [F, 1], [F, 1], [E, 1], [E, 1], [D, 2],
      [G, 1], [G, 1], [F, 1], [F, 1], [E, 1], [E, 1], [D, 2],
      [C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2],
      [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 3],
    ];
    const beat = 0.5;
    let at = ctx.currentTime + 0.05;
    tune.forEach(([hz, beats], n) => {
      // Slows down a touch at the very end, like a music box winding down.
      const slow = n > tune.length - 5 ? 1 + (n - (tune.length - 5)) * 0.12 : 1;
      chime(ctx, out, at, hz, 0.5, 1.6);
      if (beats > 1) chime(ctx, out, at, hz / 2, 0.18, 1.8);
      at += beats * beat * slow;
    });
    window.setTimeout(() => { if (lullaby === out) lullaby = null; }, (at - ctx.currentTime) * 1000 + 2000);
  } catch {
    /* audio not available */
  }
}

export function stopLullaby() {
  const ctx = context;
  if (!lullaby || !ctx) return;
  const out = lullaby;
  lullaby = null;
  out.gain.cancelScheduledValues(ctx.currentTime);
  out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
  out.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
  window.setTimeout(() => out.disconnect(), 800);
}

/** Plays one of the baby's sounds at the voice of `stage` (1-4). */
export function playBabySound(kind: BabySound, stage = 1) {
  if (!babySoundOn()) return;
  const ctx = audio();
  if (!ctx) return;
  try {
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    if (kind === "sneeze") {
      // The "CHOO": a sharp burst of air.
      breath(ctx, out, t0 + 0.8, 0.2, 0.55, 3600, 0.7);
      breath(ctx, out, t0 + 0.82, 0.14, 0.3, 1400, 1);
    }
    if (kind === "cough") {
      breath(ctx, out, t0, 0.12, 0.35, 900, 1.1);
      breath(ctx, out, t0 + 0.24, 0.12, 0.3, 900, 1.1);
    }
    if (kind === "kiss") {
      // The smack of the kiss.
      breath(ctx, out, t0 + 0.11, 0.035, 0.5, 2400, 2);
      blip(ctx, out, t0 + 0.11, 1800, 900, 0.03, 0.12);
    }
    if (kind === "splash") {
      // Water swishing and bubbles popping at random.
      breath(ctx, out, t0, 0.5, 0.12, 700, 0.6);
      for (let n = 0; n < 9; n++) {
        const at = t0 + 0.05 + Math.random() * 0.7;
        const hz = 380 + Math.random() * 500;
        blip(ctx, out, at, hz, hz * (2.2 + Math.random()), 0.05 + Math.random() * 0.04, 0.16 + Math.random() * 0.1);
      }
      return;
    }
    if (kind === "squeak") {
      // A rubber duck: two squeezes.
      for (const at of [t0, t0 + 0.24]) {
        const osc = ctx.createOscillator(), band = ctx.createBiquadFilter(), g = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1000, at);
        osc.frequency.linearRampToValueAtTime(1500, at + 0.05);
        osc.frequency.linearRampToValueAtTime(1150, at + 0.16);
        band.type = "bandpass";
        band.frequency.value = 1700;
        band.Q.value = 2.5;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
        osc.connect(band).connect(g).connect(out);
        osc.start(at);
        osc.stop(at + 0.2);
      }
      return;
    }
    if (kind === "coin") {
      blip(ctx, out, t0, 988, 988, 0.09, 0.2, "square");
      chime(ctx, out, t0 + 0.08, 1319, 0.35, 0.7);
      return;
    }
    if (kind === "levelup") {
      [523, 659, 784, 1047, 1319].forEach((hz, n) => chime(ctx, out, t0 + n * 0.11, hz, 0.4, 1.2));
      chime(ctx, out, t0 + 0.62, 1568, 0.3, 1.8);
      return;
    }
    const i = Math.min(3, Math.max(0, stage - 1));
    if (kind === "snore") {
      // Two slow, soft breaths.
      breath(ctx, out, t0, 1.3, 0.16, 420, 1.2);
      breath(ctx, out, t0 + 1.5, 1.1, 0.1, 900, 0.9);
      return;
    }
    if (kind === "sparkle") {
      [1568, 2093, 2637, 3136].forEach((hz, n) => {
        const osc = ctx.createOscillator(), g = ctx.createGain(), at = t0 + n * 0.07;
        osc.type = "triangle";
        osc.frequency.value = hz;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.18, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
        osc.connect(g).connect(out);
        osc.start(at);
        osc.stop(at + 0.5);
      });
      return;
    }
    for (const s of sequence(kind)) syllable(ctx, out, t0, s, PITCH[i], FORMANT[i]);
  } catch {
    /* audio not available */
  }
}
