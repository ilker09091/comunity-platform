/** Pure growth rules for "our baby"; the service stores state and authorizes. */

/** XP needed to reach stage 1 (baby), 2 (toddler), 3 (child) and 4 (big kid). */
export const STAGE_XP = [0, 800, 2000, 4500];
export const STAGE_NAMES = ['Baby', 'Toddler', 'Child', 'Big kid'];
/** Hours for a full tummy / full happiness to run down to zero. */
export const FULLNESS_HOURS = 16;
export const HAPPINESS_HOURS = 36;
/** Per parent, per (UTC) day: growth can't be rushed. */
export const DAILY_LIMITS = { feeds: 3, plays: 3, chats: 10, games: 2 } as const;
export const XP = { feeds: 4, plays: 3, chats: 1, games: 5, bothBonus: 10 } as const;
export const FEED_FULLNESS = 35;
export const PLAY_HAPPINESS = 25;
export const CHAT_HAPPINESS = 2;
export const FOOD_COUNT = 12;
export const TOY_COUNT = 6;
export const OUTFIT_COUNT = 6;

export type CareKind = keyof typeof DAILY_LIMITS;

/** A meter (0-100) that was `value` at `at` and runs down over `hours`. */
export function decayed(value: number, at: Date, hours: number, now = new Date()) {
  const elapsed = Math.max(0, now.getTime() - at.getTime()) / 3_600_000;
  return Math.max(0, Math.min(100, Math.round(value - (elapsed * 100) / hours)));
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

export function moodOf(fullness: number, happiness: number): 'hungry' | 'sad' | 'happy' {
  if (fullness < 25) return 'hungry';
  if (happiness < 25) return 'sad';
  return 'happy';
}

/** A hungry child grows at half speed until someone feeds them; it never "dies". */
export function grantedXp(kind: CareKind, fullness: number) {
  const xp = XP[kind];
  return fullness === 0 ? Math.ceil(xp / 2) : xp;
}
