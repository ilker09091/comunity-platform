import { AppException, ErrorCode } from '../errors/app.exception.js';
import type { Page } from '../dto/common.dto.js';

type CursorValue = string | number;

/** Cursors are opaque base64url-encoded JSON tuples, e.g. `[createdAtIso, id]`. */
export function encodeCursor(values: CursorValue[]): string {
  return Buffer.from(JSON.stringify({ v: values }), 'utf8').toString('base64url');
}

const invalid = () => AppException.badRequest(ErrorCode.INVALID_CURSOR, 'Invalid pagination cursor');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CursorShape = ('date' | 'uuid' | 'number' | 'decimal')[];

/** Decodes and strictly validates a cursor against the expected tuple shape. */
export function decodeCursor(cursor: string | undefined, shape: CursorShape): CursorValue[] | null {
  if (!cursor) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw invalid();
  }
  const values = (parsed as { v?: unknown })?.v;
  if (!Array.isArray(values) || values.length !== shape.length) throw invalid();
  return shape.map((kind, i) => {
    const value = values[i];
    switch (kind) {
      case 'date':
        if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw invalid();
        return new Date(value).toISOString();
      case 'uuid':
        if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid();
        return value;
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) throw invalid();
        return value;
      case 'decimal':
        if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) throw invalid();
        return value;
    }
  });
}

/**
 * Turns `limit + 1` fetched rows into a page. `cursorOf` builds the cursor tuple from the
 * last row that is returned.
 */
export function toPage<R, T>(
  rows: R[],
  limit: number,
  map: (row: R) => T,
  cursorOf: (row: R) => CursorValue[],
): Page<T> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(map),
    nextCursor: hasMore ? encodeCursor(cursorOf(pageRows[pageRows.length - 1])) : null,
    hasMore,
  };
}

export function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}
