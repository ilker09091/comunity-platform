import { describe, expect, it } from 'vitest';
import { decayed, FULLNESS_HOURS, grantedXp, moodOf, stageOf, STAGE_XP, XP } from './baby.js';

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
});
