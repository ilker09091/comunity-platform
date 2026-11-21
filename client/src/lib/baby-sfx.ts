/**
 * Recorded sounds for "our baby" (public-domain / CC0 clips in /public/baby/sfx, see
 * CREDITS.txt there). Clips are fetched once, decoded with WebAudio and played with a tiny
 * random pitch change so repeats never sound robotic. Ambience loops cross-fade per place.
 * Everything respects the same mute switch as the synthesized baby voice.
 */
import { babySoundOn, playBabySound, type BabySound } from "./baby-sounds";

/** Each sound name maps to one or more clip variants (picked at random). */
const CLIPS = {
  // Interface (Kenney, CC0)
  tap: ["tap"], select: ["select"], success: ["success"], place: ["place"], pop: ["pop", "pop2"], sparkle: ["sparkle"],
  toggle: ["toggle"], open: ["open"], close: ["close"], whoosh: ["whoosh"], back: ["back"], hmm: ["hmm"], nope: ["nope"],
  bong: ["bong"], scrub: ["scrub"],
  // The baby (a real baby, public domain)
  laugh: ["laugh-1", "laugh-2", "laugh-3"],
  coo: ["coo-1", "coo-2", "coo-3", "coo-4"],
  babble: ["babble-1", "babble-2", "babble-3"],
  fuss: ["fuss-1", "fuss-2"],
  cry: ["cry-1"],
  // Places and things (public domain / CC0)
  splash: ["splash-1", "splash-2", "splash-3"],
  duck: ["duck-1"],
  step: ["step-1", "step-2", "step-3", "step-4"],
  "step-grass": ["grass-1", "grass-2", "grass-3"],
  // Jingles (Kenney, CC0)
  "jingle-win": ["jingle-win"], "jingle-coin": ["jingle-coin"], "jingle-up": ["jingle-up"], "jingle-love": ["jingle-love"],
} as const;
export type Sfx = keyof typeof CLIPS;

export type Ambience = "garden" | "park" | "bath" | "kitchen" | "rain";

let ctx: AudioContext | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();

function audio() {
  if (typeof window === "undefined") return null;
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  ctx ??= new Context();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function load(file: string) {
  let pending = buffers.get(file);
  if (!pending) {
    const c = audio();
    pending = c
      ? fetch(`/baby/sfx/${file}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
        .then((data) => c.decodeAudioData(data)).catch(() => null)
      : Promise.resolve(null);
    buffers.set(file, pending);
  }
  return pending;
}

/** Fetches clips ahead of time so the first tap plays instantly. */
export function preloadSfx(names: Sfx[]) {
  if (!babySoundOn()) return;
  for (const n of names) for (const f of CLIPS[n]) void load(f);
}

/** Plays a recorded sound. Resolves to its length in seconds (0 when muted or missing). */
export async function playSfx(name: Sfx, { volume = 0.8, pitch = 1, delay = 0 }: { volume?: number; pitch?: number; delay?: number } = {}) {
  if (!babySoundOn()) return 0;
  const c = audio();
  if (!c) return 0;
  const variants = CLIPS[name];
  const buffer = await load(variants[Math.floor(Math.random() * variants.length)]);
  if (!buffer) return 0;
  try {
    const src = c.createBufferSource(), gain = c.createGain();
    src.buffer = buffer;
    src.playbackRate.value = pitch * (0.96 + Math.random() * 0.08);
    gain.gain.value = volume;
    src.connect(gain).connect(c.destination);
    src.start(c.currentTime + delay);
    return buffer.duration / src.playbackRate.value;
  } catch {
    return 0;
  }
}

/** The baby's recorded voice sounds a little higher for a baby, a little lower for a big kid. */
export const voicePitch = (stage: number) => [1.08, 1, 0.94, 0.9][Math.min(3, Math.max(0, stage - 1))];

let current: { name: Ambience; gain: GainNode; src: AudioBufferSourceNode } | null = null;

/** Starts (or switches to) a looping background ambience; null stops it. Fades over ~1.2 s. */
export async function setAmbience(name: Ambience | null, volume = 0.22) {
  const c = audio();
  if (!c || current?.name === name) return;
  const old = current;
  current = null;
  if (old) {
    old.gain.gain.cancelScheduledValues(c.currentTime);
    old.gain.gain.setValueAtTime(old.gain.gain.value, c.currentTime);
    old.gain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 1.2);
    old.src.stop(c.currentTime + 1.3);
  }
  if (!name || !babySoundOn()) return;
  const buffer = await load(`amb-${name}`);
  if (!buffer || current) return;
  const src = c.createBufferSource(), gain = c.createGain();
  src.buffer = buffer;
  src.loop = true;
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(volume, c.currentTime + 1.2);
  src.connect(gain).connect(c.destination);
  src.start();
  current = { name, gain, src };
}


/** Recorded clips that stand in for synthesized sounds when the clip exists. */
const RECORDED: Partial<Record<BabySound, { clip: Sfx; voice?: boolean; volume?: number }>> = {
  giggle: { clip: "laugh", voice: true },
  tickle: { clip: "laugh", voice: true },
  coo: { clip: "coo", voice: true },
  pat: { clip: "coo", voice: true, volume: 0.7 },
  cry: { clip: "cry", voice: true, volume: 0.7 },
  whine: { clip: "fuss", voice: true, volume: 0.6 },
  splash: { clip: "splash", volume: 0.6 },
  coin: { clip: "jingle-coin", volume: 0.6 },
  levelup: { clip: "jingle-up", volume: 0.6 },
};

/** The baby's sounds: a real recording when there is one, otherwise the synthesized voice. */
export function babyVoice(sound: BabySound, stage = 1) {
  // Toddlers and up chatter instead of just cooing; babies fuss instead of crying hard.
  const r = sound === "coo" && stage >= 2 && Math.random() < 0.6 ? { clip: "babble" as const, voice: true }
    : sound === "cry" && stage === 1 ? { clip: "fuss" as const, voice: true }
    : RECORDED[sound];
  if (!r) return playBabySound(sound, stage);
  void playSfx(r.clip, { pitch: r.voice ? voicePitch(stage) : 1, volume: r.volume ?? 0.8 }).then((played) => {
    if (!played) playBabySound(sound, stage);
  });
}
