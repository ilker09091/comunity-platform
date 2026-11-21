/** Pure growth rules for "our baby"; the service stores state and authorizes. */

/** XP needed to reach stage 1 (baby), 2 (toddler), 3 (child) and 4 (big kid). */
export const STAGE_XP = [0, 800, 2000, 4500];
export const STAGE_NAMES = ['Baby', 'Toddler', 'Child', 'Big kid'];
/** Hours for a full meter to run down to zero. */
export const FULLNESS_HOURS = 16;
export const HAPPINESS_HOURS = 36;
export const CLEAN_HOURS = 40;
/** Awake, energy runs out over this many hours; asleep, it fills up over SLEEP_HOURS. */
export const AWAKE_HOURS = 20;
export const SLEEP_HOURS = 8;
/** A child nobody wakes gets up on their own after this long. */
export const MAX_SLEEP_HOURS = 11;
/** Per parent, per (UTC) day: growth can't be rushed. */
export const DAILY_LIMITS = { feeds: 3, plays: 3, chats: 10, games: 2, baths: 2, sleeps: 1 } as const;
export const XP = { feeds: 4, plays: 3, chats: 1, games: 5, baths: 3, sleeps: 3, bothBonus: 10, familyHug: 15 } as const;
/** Coins go into one shared piggy bank. */
export const COINS = { feeds: 2, plays: 2, chats: 1, games: 5, baths: 3, sleeps: 3, bothBonus: 10, familyHug: 20, stageUp: 100 } as const;
export const FEED_FULLNESS = 35;
export const PLAY_HAPPINESS = 25;
export const CHAT_HAPPINESS = 2;
export const HUG_HAPPINESS = 4;
export const FAMILY_HUG_HAPPINESS = 15;
/** Both parents hugging within this many minutes is a family hug. */
export const FAMILY_HUG_MINUTES = 5;
/** One dose from each parent cures a cold; a single dose does it alone after this long. */
export const SOLO_CURE_HOURS = 12;
export const FOOD_COUNT = 12;
export const FREE_TOYS = 6;
export const TOY_COUNT = 12;
export const OUTFIT_COUNT = 6;

export type CareKind = keyof typeof DAILY_LIMITS;
export type Mood = 'happy' | 'hungry' | 'sad' | 'sick' | 'sleepy' | 'dirty';
export type DecorSlot = 'room' | 'hang' | 'floor' | 'frame';
export type ShopItem = { id: string; kind: 'toy' | 'decor'; slot?: DecorSlot; price: number };

/** Everything the piggy bank can buy. Art lives in the client under the same ids. */
export const SHOP: readonly ShopItem[] = [
  { id: 'toy-6', kind: 'toy', price: 60 },
  { id: 'toy-7', kind: 'toy', price: 60 },
  { id: 'toy-8', kind: 'toy', price: 80 },
  { id: 'toy-9', kind: 'toy', price: 50 },
  { id: 'toy-10', kind: 'toy', price: 80 },
  { id: 'toy-11', kind: 'toy', price: 100 },
  { id: 'frame', kind: 'decor', slot: 'frame', price: 40 },
  { id: 'hang-bunting', kind: 'decor', slot: 'hang', price: 80 },
  { id: 'hang-lights', kind: 'decor', slot: 'hang', price: 120 },
  { id: 'hang-balloons', kind: 'decor', slot: 'hang', price: 100 },
  { id: 'hang-mobile', kind: 'decor', slot: 'hang', price: 120 },
  { id: 'floor-horse', kind: 'decor', slot: 'floor', price: 150 },
  { id: 'floor-tent', kind: 'decor', slot: 'floor', price: 200 },
  { id: 'floor-toybox', kind: 'decor', slot: 'floor', price: 120 },
  { id: 'floor-bunny', kind: 'decor', slot: 'floor', price: 140 },
  { id: 'room-ocean', kind: 'decor', slot: 'room', price: 300 },
  { id: 'room-space', kind: 'decor', slot: 'room', price: 300 },
  { id: 'room-garden', kind: 'decor', slot: 'room', price: 300 },
];
export const SHOP_IDS = SHOP.map((i) => i.id);
export const DECOR_SLOTS: readonly DecorSlot[] = ['room', 'hang', 'floor', 'frame'];

/**
 * Words a child picks up from how the parents talk to each other. Matched case-insensitively
 * inside messages; the couple's private nicknames for each other are added on top.
 */
export const LOVE_WORDS = [
  'aşkım', 'canım', 'bebeğim', 'sevgilim', 'hayatım', 'tatlım', 'kuzum', 'balım', 'birtanem', 'bitanem',
  'güzelim', 'meleğim', 'prensesim', 'yakışıklım', 'cicim', 'gülüm', 'seni seviyorum', 'anne', 'baba',
  'mama', 'papa', 'my love', 'love you', 'babe', 'honey', 'darling', 'sweetie',
];
/** What a toddler says first when the chat gives them nothing to copy. */
export const FALLBACK_FIRST_WORD = 'mama';
export const WORD_STAGE = 2;

/** A meter (0-100) that was `value` at `at` and runs down over `hours`. */
export function decayed(value: number, at: Date, hours: number, now = new Date()) {
  const elapsed = Math.max(0, now.getTime() - at.getTime()) / 3_600_000;
  return Math.max(0, Math.min(100, Math.round(value - (elapsed * 100) / hours)));
}

/** Energy now: filling up while asleep, running down while awake. */
export function energyOf(energy: number, at: Date, asleepAt: Date | null, now = new Date()) {
  if (!asleepAt) return decayed(energy, at, AWAKE_HOURS, now);
  const slept = Math.max(0, now.getTime() - asleepAt.getTime()) / 3_600_000;
  return Math.max(0, Math.min(100, Math.round(energy + (slept * 100) / SLEEP_HOURS)));
}

export function stageOf(xp: number) {
  let stage = 1;
  for (let i = STAGE_XP.length - 1; i > 0; i--) if (xp >= STAGE_XP[i]) { stage = i + 1; break; }
  return {
    stage,
    stageXp: STAGE_XP[stage - 1],
    nextStageXp: stage < STAGE_XP.length ? STAGE_XP[stage] : null,
  };
}

/** The most pressing need wins: a cold, then hunger, tiredness, a bath, then attention. */
export function moodOf(fullness: number, happiness: number, clean = 100, energy = 100, sick = false): Mood {
  if (sick) return 'sick';
  if (fullness < 25) return 'hungry';
  if (energy < 20) return 'sleepy';
  if (clean < 20) return 'dirty';
  if (happiness < 25) return 'sad';
  return 'happy';
}

/** Left hungry and unwashed for a long time, a child catches a cold (never anything worse). */
export function catchesCold(fullness: number, clean: number, happiness: number) {
  return fullness === 0 && (clean <= 10 || happiness === 0);
}

/** A hungry or poorly child grows at half speed until someone looks after them; it never "dies". */
export function grantedXp(kind: CareKind, fullness: number, sick = false) {
  const xp = XP[kind];
  return fullness === 0 || sick ? Math.ceil(xp / 2) : xp;
}

/** Lower-cases a word the way Turkish does (I → ı, İ → i) and trims it. */
export function normalizeWord(word: string) {
  return word.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr');
}

/** A word a parent may teach: 1-20 letters (spaces, apostrophes and hyphens allowed inside). */
export function teachableWord(word: string) {
  const w = normalizeWord(word);
  return /^\p{L}[\p{L}' -]{0,19}$/u.test(w) && !/[' -]$/.test(w) ? w : null;
}

/** The first candidate that appears in `text` and isn't known yet. */
export function wordToLearn(text: string, candidates: string[], known: Set<string>) {
  const t = normalizeWord(text);
  return candidates.map(normalizeWord).find((w) => w && !known.has(w) && t.includes(w)) ?? null;
}

/** Places in the baby's world, and the little signals parents can send each other there. */
export const SCENES = ['nursery', 'kitchen', 'bathroom', 'garden', 'park'] as const;
export type Scene = (typeof SCENES)[number];
export const SIGNALS = ['heart', 'wave', 'kiss', 'star'] as const;
export type Signal = (typeof SIGNALS)[number];
/** A parent counts as "here" this long after their last check-in. */
export const HERE_SECONDS = 25;
