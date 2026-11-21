import { describe, expect, it } from 'vitest';
import {
  catchesCold, decayed, energyOf, FULLNESS_HOURS, grantedXp, moodOf, normalizeWord, SHOP, stageOf, STAGE_XP, teachableWord, wordToLearn, XP,
} from './baby.js';

describe('our baby rules', () => {
  it('meters run down linearly and never leave 0..100', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(decayed(80, at, FULLNESS_HOURS, at)).toBe(80);
    expect(decayed(100, at, FULLNESS_HOURS, new Date('2026-01-01T08:00:00Z'))).toBe(50);
    expect(decayed(30, at, FULLNESS_HOURS, new Date('2026-01-03T00:00:00Z'))).toBe(0);
    expect(decayed(50, at, FULLNESS_HOURS, new Date('2025-12-31T00:00:00Z'))).toBe(50);
  });

  it('stages follow the XP thresholds', () => {
    expect(stageOf(0)).toEqual({ stage: 1, stageXp: 0, nextStageXp: STAGE_XP[1] });
    expect(stageOf(STAGE_XP[1] - 1).stage).toBe(1);
    expect(stageOf(STAGE_XP[1]).stage).toBe(2);
    expect(stageOf(STAGE_XP[2] + 5).stage).toBe(3);
    expect(stageOf(STAGE_XP[3] + 9999)).toEqual({ stage: 4, stageXp: STAGE_XP[3], nextStageXp: null });
  });

  it('mood: hunger comes first, then sadness', () => {
    expect(moodOf(10, 10)).toBe('hungry');
    expect(moodOf(60, 10)).toBe('sad');
    expect(moodOf(60, 60)).toBe('happy');
  });

  it('a starving child grows at half speed', () => {
    expect(grantedXp('feeds', 50)).toBe(XP.feeds);
    expect(grantedXp('plays', 0)).toBe(Math.ceil(XP.plays / 2));
  });

  it('energy runs down awake and fills up asleep, within 0..100', () => {
    const at = new Date('2026-01-01T00:00:00Z');
    expect(energyOf(100, at, null, new Date('2026-01-01T10:00:00Z'))).toBe(50);
    expect(energyOf(20, at, at, new Date('2026-01-01T04:00:00Z'))).toBe(70);
    expect(energyOf(90, at, at, new Date('2026-01-02T00:00:00Z'))).toBe(100);
  });

  it('mood: a cold first, then hunger, tiredness, a bath, sadness', () => {
    expect(moodOf(10, 10, 10, 10, true)).toBe('sick');
    expect(moodOf(10, 90, 90, 10)).toBe('hungry');
    expect(moodOf(90, 90, 10, 10)).toBe('sleepy');
    expect(moodOf(90, 10, 10, 90)).toBe('dirty');
    expect(moodOf(90, 10, 90, 90)).toBe('sad');
  });

  it('only long neglect brings a cold, and a cold halves growth', () => {
    expect(catchesCold(0, 5, 50)).toBe(true);
    expect(catchesCold(0, 50, 0)).toBe(true);
    expect(catchesCold(0, 50, 50)).toBe(false);
    expect(catchesCold(10, 0, 0)).toBe(false);
    expect(grantedXp('games', 80, true)).toBe(Math.ceil(XP.games / 2));
  });

  it('words: Turkish lower-casing, teachable words, learning from a message', () => {
    expect(normalizeWord('  AŞKIM  ')).toBe('aşkım');
    expect(normalizeWord('İLKER')).toBe('ilker');
    expect(teachableWord('Pamuk')).toBe('pamuk');
    expect(teachableWord('seni  seviyorum')).toBe('seni seviyorum');
    expect(teachableWord('123')).toBeNull();
    expect(teachableWord('hi!')).toBeNull();
    expect(teachableWord('a'.repeat(21))).toBeNull();
    expect(wordToLearn('Günaydın AŞKIM nasılsın', ['canım', 'aşkım'], new Set())).toBe('aşkım');
    expect(wordToLearn('günaydın aşkım', ['aşkım'], new Set(['aşkım']))).toBeNull();
  });

  it('shop ids are unique and every decoration has a slot', () => {
    expect(new Set(SHOP.map((i) => i.id)).size).toBe(SHOP.length);
    for (const item of SHOP) expect(item.kind === 'toy' ? !item.slot : !!item.slot).toBe(true);
  });
});
