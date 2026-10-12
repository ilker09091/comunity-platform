import { parseInteraction } from './post-interactions.js';

describe('parseInteraction', () => {
  it('reads polls with 2–4 options', () => {
    expect(parseInteraction('Hafta sonu? [poll:Nereye|Deniz|Dağ|Şehir] 🙂')).toEqual({ kind: 'POLL', options: 3, correct: null });
    expect(parseInteraction('[poll:Tek|A]')).toBeNull();
    expect(parseInteraction('[poll:Çok|A|B|C|D|E]')).toBeNull();
  });

  it('reads quizzes with a valid correct index', () => {
    expect(parseInteraction('[quiz:Başkent|1|İstanbul|Ankara]')).toEqual({ kind: 'QUIZ', options: 2, correct: 1 });
    expect(parseInteraction('[quiz:Başkent|5|İstanbul|Ankara]')).toBeNull();
    expect(parseInteraction('[quiz:Başkent|x|İstanbul|Ankara]')).toBeNull();
  });

  it('reads sliders and ignores posts without a votable widget', () => {
    expect(parseInteraction('[SLIDER:Nasıl|😐|🔥]')).toEqual({ kind: 'SLIDER', options: 0, correct: null });
    expect(parseInteraction('[countdown:2030-01-01]')).toBeNull();
    expect(parseInteraction('[ask:Bana sor]')).toBeNull();
    expect(parseInteraction('just text')).toBeNull();
    expect(parseInteraction(null)).toBeNull();
  });
});
