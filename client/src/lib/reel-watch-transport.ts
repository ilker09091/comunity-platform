import { api, ApiError, type Models } from './api/client';
import type { WatchDelta } from './reel-watch';

type Event = Models['ReelWatchEventDto'];
type Channel = { tail: Promise<void>; sequence: number; ready: boolean; failed: boolean; pending: number };
const channels = new Map<string, Channel>();
export async function flushReelWatches() { await Promise.all([...channels.values()].map(c => c.tail)); }

/** Serialized exposure + event batches preserve sequence order across player remounts.
 * Retry the same sequence (server idempotence); cap memory during an offline session. */
export function watchSender(sessionId: string, postId: string, mediaId?: string): (delta: WatchDelta) => void {
  const key = `${sessionId}:${postId}`;
  let channel = channels.get(key);
  if (!channel) {
    channel = { tail: Promise.resolve(), sequence: 0, ready: false, failed: false, pending: 0 };
    channels.set(key, channel);
    if (channels.size > 400) for (const [id, value] of channels) { if (!value.pending && id !== key) channels.delete(id); if (channels.size <= 300) break; }
  }
  const c = channel;
  return delta => {
    if (c.failed || c.pending >= 20) return;
    c.pending++;
    c.tail = c.tail.then(async () => {
      if (c.failed) return;
      if (!c.ready) { const result = await api('feedExpose', { body: { sessionId, postId }, keepalive: true }); c.sequence = result.nextSequence - 1; c.ready = true; }
      const event: Event = { ...delta, postId, mediaId, sequence: ++c.sequence };
      for (let attempt = 0; attempt < 3; attempt++) {
        try { await api('feedWatch', { body: { sessionId, events: [event] }, keepalive: true }); return; }
        catch (error) {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) throw error;
          if (attempt === 2) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.max(1000 * (attempt + 1), error instanceof ApiError ? (error.retryAfter ?? 0) * 1000 : 0)));
        }
      }
    }).catch(error => {
      c.ready = false;
      c.failed = error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429;
    }).finally(() => { c.pending--; });
  };
}
