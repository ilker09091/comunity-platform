import { parseDurationSeconds } from '../../config/app.config.js';
import { AppException } from '../errors/app.exception.js';
import { decodeCursor, encodeCursor, toPage } from './cursor.js';
import { sanitizeText } from './sanitize.js';
import { escapeLike } from './sql.js';

describe('cursor', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  it('round-trips typed tuples', () => {
    const cursor = encodeCursor(['2026-10-11T12:00:00.000Z', id]);
    expect(decodeCursor(cursor, ['date', 'uuid'])).toEqual(['2026-10-11T12:00:00.000Z', id]);
    expect(decodeCursor(encodeCursor(['1.250000', id]), ['decimal', 'uuid'])).toEqual(['1.250000', id]);
  });

  it('rejects tampered or mismatched cursors with INVALID_CURSOR', () => {
    for (const bad of ['%%%', encodeCursor([id]), encodeCursor(['not-a-date', id]), encodeCursor(['2026-01-01', 'x'])]) {
      expect(() => decodeCursor(bad, ['date', 'uuid'])).toThrow(AppException);
    }
    expect(() => decodeCursor(encodeCursor(["1; DROP TABLE", id]), ['decimal', 'uuid'])).toThrow(AppException);
  });

  it('builds pages from limit + 1 rows', () => {
    const rows = [1, 2, 3].map((n) => ({ n }));
    const page = toPage(rows, 2, (r) => r.n, (r) => [r.n]);
    expect(page.items).toEqual([1, 2]);
    expect(page.hasMore).toBe(true);
    expect(decodeCursor(page.nextCursor!, ['number'])).toEqual([2]);
    expect(toPage(rows, 3, (r) => r.n, (r) => [r.n])).toEqual({ items: [1, 2, 3], nextCursor: null, hasMore: false });
  });
});

describe('sanitizeText', () => {
  it('strips control characters and normalises whitespace', () => {
    expect(sanitizeText('  a\u0000b\u0007 \r\nc  ', { multiline: true })).toBe('ab \nc');
    expect(sanitizeText('a\nb\tc', { multiline: false })).toBe('a b c');
    expect(sanitizeText('é', { multiline: false })).toBe('é');
  });
});

describe('helpers', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('parses durations', () => {
    expect(parseDurationSeconds('15m', 0)).toBe(900);
    expect(parseDurationSeconds('1d', 0)).toBe(86400);
    expect(parseDurationSeconds('3600', 0)).toBe(3600);
    expect(parseDurationSeconds(undefined, 42)).toBe(42);
    expect(() => parseDurationSeconds('soon', 0)).toThrow();
  });
});
