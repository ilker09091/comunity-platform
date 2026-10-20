import { createHash } from 'node:crypto';

export type PromptTemplate = { kind: 'text' | 'photo' | 'poll'; text: string; options?: string[] };

/**
 * The built-in daily questions. Deliberately positive: no "who is the worst…" polls and nothing
 * that ranks or singles out a member, so the feature stays safe for school circles.
 */
export const DAILY_PROMPTS: PromptTemplate[] = [
  { kind: 'photo', text: 'Show us the view from where you are right now.' },
  { kind: 'photo', text: 'What did you eat today? Photo or it didn’t happen.' },
  { kind: 'photo', text: 'Share the last photo in your camera roll that made you smile.' },
  { kind: 'photo', text: 'Your desk, bag or pocket — what’s in it right now?' },
  { kind: 'photo', text: 'Show us something blue.' },
  { kind: 'photo', text: 'Snap the sky where you are.' },
  { kind: 'photo', text: 'Your shoes today. Go.' },
  { kind: 'photo', text: 'Something you made or fixed recently.' },
  { kind: 'photo', text: 'The best thing you saw outside today.' },
  { kind: 'photo', text: 'Your current wallpaper.' },
  { kind: 'text', text: 'What’s one small win you had today?' },
  { kind: 'text', text: 'What song is stuck in your head?' },
  { kind: 'text', text: 'Describe your day in three emojis.' },
  { kind: 'text', text: 'What are you looking forward to this week?' },
  { kind: 'text', text: 'Recommend one thing (a show, a game, a book) to the circle.' },
  { kind: 'text', text: 'What’s something you learned recently?' },
  { kind: 'text', text: 'If today had a title, what would it be?' },
  { kind: 'text', text: 'Who in this circle would you call in an emergency, and why?' },
  { kind: 'text', text: 'Thank someone in the circle for something.' },
  { kind: 'text', text: 'What’s the funniest thing that happened to you this week?' },
  { kind: 'text', text: 'One goal for tomorrow?' },
  { kind: 'text', text: 'What would your perfect weekend look like?' },
  { kind: 'text', text: 'What’s a skill you’d like to learn?' },
  { kind: 'text', text: 'Best snack of all time. Defend your answer.' },
  { kind: 'poll', text: 'Morning person or night owl?', options: ['Morning', 'Night'] },
  { kind: 'poll', text: 'Pizza or burger?', options: ['Pizza', 'Burger'] },
  { kind: 'poll', text: 'Where should the next hangout be?', options: ['Café', 'Park', 'Someone’s place', 'Cinema'] },
  { kind: 'poll', text: 'Tea or coffee?', options: ['Tea', 'Coffee', 'Neither'] },
  { kind: 'poll', text: 'Beach or mountains?', options: ['Beach', 'Mountains'] },
  { kind: 'poll', text: 'How’s your energy today?', options: ['Full battery', 'Half', 'Running on fumes'] },
  { kind: 'poll', text: 'Cats or dogs?', options: ['Cats', 'Dogs', 'Both'] },
  { kind: 'poll', text: 'Movie night pick?', options: ['Comedy', 'Horror', 'Action', 'Animation'] },
  { kind: 'poll', text: 'Summer or winter?', options: ['Summer', 'Winter'] },
  { kind: 'poll', text: 'Best time to study?', options: ['Early morning', 'Afternoon', 'Late night'] },
];

/** The same question for every member of a circle on a given day, different across circles. */
export function promptFor(circleId: string, day: string): PromptTemplate {
  const hash = createHash('sha256').update(`${circleId}:${day}`).digest();
  return DAILY_PROMPTS[hash.readUInt32BE(0) % DAILY_PROMPTS.length];
}
