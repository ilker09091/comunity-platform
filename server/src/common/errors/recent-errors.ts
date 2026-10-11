/**
 * Small in-memory ring buffer of recent server errors (5xx) for the admin System Status page.
 * Stores only request metadata and a truncated error summary — never bodies, headers or tokens.
 */
export interface RecentError {
  at: string;
  requestId: string | null;
  method: string;
  path: string;
  statusCode: number;
  error: string;
}

const LIMIT = 50;
const buffer: RecentError[] = [];

export function recordServerError(entry: RecentError) {
  buffer.unshift({ ...entry, error: entry.error.slice(0, 200), path: entry.path.slice(0, 200) });
  if (buffer.length > LIMIT) buffer.length = LIMIT;
}

export function recentServerErrors(): RecentError[] {
  return buffer.map((e) => ({ ...e }));
}
