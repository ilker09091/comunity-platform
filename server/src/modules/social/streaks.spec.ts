import { describeStreak, type StreakRow } from './streaks.service.js';
const row: StreakRow={days:10,last_day:'2026-10-10',low_day:'2026-10-10',high_day:'2026-10-10',month:null,restores_used:0};
describe('daily message streak boundaries',()=>{
  it('starts with three reciprocal days, not individual messages',()=>{
    expect(describeStreak(null,true,new Date('2026-10-10T12:00Z')).days).toBe(0);
    expect(describeStreak({...row,days:2},true,new Date('2026-10-10T12:00Z')).state).toBe('building');
    expect(describeStreak({...row,days:3},true,new Date('2026-10-10T12:00Z')).state).toBe('active');
  });
  it('fades at the missed-day boundary and expires 24 hours later',()=>{
    expect(describeStreak(row,true,new Date('2026-10-11T23:59:59Z')).state).toBe('active');
    expect(describeStreak(row,true,new Date('2026-10-12T00:00Z')).state).toBe('fading');
    expect(describeStreak(row,true,new Date('2026-10-13T00:00Z')).state).toBe('expired');
  });
  it('allows restoration for exactly 48 hours and limits monthly restores',()=>{
    expect(describeStreak(row,true,new Date('2026-10-14T23:59:59Z')).canRestore).toBe(true);
    expect(describeStreak(row,true,new Date('2026-10-15T00:00Z')).canRestore).toBe(false);
    expect(describeStreak({...row,month:'2026-10-01',restores_used:3},true,new Date('2026-10-13T12:00Z')).canRestore).toBe(false);
  });
  it('reports the correct participant and does not activate a one-sided day',()=>{
    const partial={...row,low_day:'2026-10-11'};
    const mine=describeStreak(partial,true,new Date('2026-10-11T12:00Z'));
    expect(mine.sentToday).toBe(true);expect(mine.peerSentToday).toBe(false);expect(mine.days).toBe(10);
    expect(describeStreak(partial,false,new Date('2026-10-11T12:00Z')).sentToday).toBe(false);
  });
});
