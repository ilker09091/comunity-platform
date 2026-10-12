import type { DataSource, EntityManager } from 'typeorm';

type Executor = DataSource | EntityManager;

/**
 * Runs raw SQL and always returns the row array.
 * TypeORM's postgres driver returns `[rows, rowCount]` for UPDATE/DELETE statements;
 * this normalises both shapes.
 */
export async function sqlRows<T = Record<string, any>>(
  db: Executor,
  query: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result: unknown = await db.query(query, params);
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === 'number'
  ) {
    return result[0] as T[];
  }
  return (result ?? []) as T[];
}

export async function sqlOne<T = Record<string, any>>(
  db: Executor,
  query: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await sqlRows<T>(db, query, params);
  return rows[0] ?? null;
}

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * SQL predicate: post `p` (author `a`) is visible to the viewer bound at parameter `$v`.
 * Hides soft-deleted / moderated posts and inactive authors, enforces blocks in both
 * directions, private accounts and FOLLOWERS-only visibility.
 */
export function postVisibleSql(p: string, a: string, v: string): string {
  return `(
    ${p}.deleted_at IS NULL
    AND ${p}.moderation_status = 'ACTIVE'
    AND ${a}.status = 'ACTIVE'
    -- Published while its video was still compressing: hidden (even from the author) until ready.
    AND NOT EXISTS (
      SELECT 1 FROM post_media pm_ready JOIN media m_ready ON m_ready.id = pm_ready.media_id
       WHERE pm_ready.post_id = ${p}.id AND m_ready.status <> 'READY'
    )
    AND (
      ${a}.id = ${v}::uuid
      OR (
        (${v}::uuid IS NULL OR NOT EXISTS (
          SELECT 1 FROM blocks bl
          WHERE (bl.blocker_id = ${a}.id AND bl.blocked_id = ${v}::uuid)
             OR (bl.blocker_id = ${v}::uuid AND bl.blocked_id = ${a}.id)
        ))
        AND (
          (${a}.is_private = false AND ${p}.visibility = 'PUBLIC')
          OR (${v}::uuid IS NOT NULL AND EXISTS (
            SELECT 1 FROM follows fv WHERE fv.follower_id = ${v}::uuid AND fv.following_id = ${a}.id
          ))
        )
      )
    )
  )`;
}

/** SQL predicate: no block exists in either direction between user column `u` and viewer `$v`. */
export function notBlockedSql(u: string, v: string): string {
  return `(${v}::uuid IS NULL OR NOT EXISTS (
    SELECT 1 FROM blocks bx
    WHERE (bx.blocker_id = ${u} AND bx.blocked_id = ${v}::uuid)
       OR (bx.blocker_id = ${v}::uuid AND bx.blocked_id = ${u})
  ))`;
}
