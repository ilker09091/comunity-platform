/**
 * Cartoon voice for "our baby", synthesized on the device (no audio files to download).
 * A buzzy source shaped by vowel formants gives "waah", "ha-ha", "ooh" and "mmm" sounds; the
 * pitch drops a little as the child grows up.
 */
export type BabySound = "giggle" | "cry" | "whine" | "coo" | "nom" | "snore" | "sparkle";

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
    case "nom":
      return [
        { at: 0, dur: 0.16, pitch: [320, 300], vowel: U, gain: 0.4, hum: true },
        { at: 0.22, dur: 0.16, pitch: [330, 310], vowel: U, gain: 0.4, hum: true },
        { at: 0.5, dur: 0.48, pitch: [360, 470, 420], vowel: U, gain: 0.38, hum: true, vibrato: 6 },
      ];
    default:
      return [];
  }
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
