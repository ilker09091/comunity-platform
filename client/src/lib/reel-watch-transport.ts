import { api, ApiError, type Models } from './api/client';
import type { WatchDelta } from './reel-watch';

type Event = Models['ReelWatchEventDto'];
type Channel = { tail: Promise<void>; sequence: number; ready: boolean; failed: boolean; pending: number; shown:boolean; position?:number };
const channels = new Map<string, Channel>();
export async function flushReelWatches() { await Promise.all([...channels.values()].map(c => c.tail)); }

/** Serialized exposure + event batches preserve sequence order across player remounts.
 * Retry the same sequence (server idempotence); cap memory during an offline session. */
export function watchSender(sessionId: string, postId: string, mediaId?: string, position?:number): ((delta:WatchDelta)=>void)&{expose:(visibleMs:number)=>void} {
  const key = `${sessionId}:${position??postId}`;
  let channel = channels.get(key);
  if (!channel) {
    channel = { tail: Promise.resolve(), sequence: 0, ready: false, failed: false, pending: 0,shown:false,position };
    channels.set(key, channel);
    if (channels.size > 400) for (const [id, value] of channels) { if (!value.pending && id !== key) channels.delete(id); if (channels.size <= 300) break; }
  }
  const c = channel;
  const send=(delta:WatchDelta) => {
    if (c.failed || c.pending >= 20) return;
    c.pending++;
    c.tail = c.tail.then(async () => {
      if (c.failed) return;
      if (!c.ready) { const result = await api('feedExpose', { body: { sessionId, postId,position:c.position,prepare:true }, keepalive: true }); c.sequence = result.nextSequence - 1;c.position=result.position; c.ready = true; }
      const event: Event = { ...delta, postId, mediaId,position:c.position, sequence: ++c.sequence };
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
  return Object.assign(send,{expose:(visibleMs:number)=>{
    if(c.shown||c.failed)return;c.shown=true;c.pending++;
    c.tail=c.tail.then(async()=>{
      for(let attempt=0;attempt<3;attempt++){
        try{
          const result=await api('feedExpose',{body:{sessionId,postId,position:c.position,visibleMs},keepalive:true});
          if(!c.ready){c.position=result.position;c.sequence=result.nextSequence-1;c.ready=true;}
          return;
        }catch(error){
          if(attempt===2||error instanceof ApiError&&error.status>=400&&error.status<500&&error.status!==429)throw error;
          await new Promise(resolve=>setTimeout(resolve,Math.max(500*(attempt+1),error instanceof ApiError?(error.retryAfter??0)*1000:0)));
        }
      }
    }).catch(()=>{c.shown=false;}).finally(()=>{c.pending--;});
  }});
}
