import { ReelSmartState1760191100000 } from '../src/database/migrations/1760191100000-ReelSmartState.js';
import type {INestApplication} from '@nestjs/common';
import {randomUUID} from 'node:crypto';
import {DataSource} from 'typeorm';
import {Api,createTestApp,resetDatabase,type TestUser} from './setup/test-app.js';

describe('Smart Reels V2',()=>{
 let app:INestApplication,api:Api,db:DataSource,viewer:TestUser,a:TestUser,b:TestUser;
 beforeAll(async()=>{app=await createTestApp();api=new Api(app);db=app.get(DataSource);});
 beforeEach(async()=>{await resetDatabase(app);viewer=await api.register('viewer');a=await api.register('creator');b=await api.register('other');});
 afterAll(()=>app.close());
 async function fixture(user:TestUser,count=1,caption='#travel',age=0){
  const ids=Array.from({length:count},()=>randomUUID()),media=ids.map(()=>randomUUID());
  await db.query(`INSERT INTO posts(id,author_id,content,created_at) SELECT id,$2,$3,now()-$4*interval '1 second'-ord*interval '1 millisecond' FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)`,[ids,user.id,caption,age]);
  await db.query(`INSERT INTO media(id,owner_id,type,status,storage_key,mime_type,size_bytes,width,height,duration_ms) SELECT id,$2,'VIDEO','READY','v2-fixture/'||id,'video/mp4',10,1080,1920,10000 FROM unnest($1::uuid[]) id`,[media,user.id]);
  await db.query('INSERT INTO post_media(post_id,media_id,position) SELECT post,media,0 FROM unnest($1::uuid[],$2::uuid[]) x(post,media)',[ids,media]);
  return ids;
 }
 const page=async(query='',user=viewer)=>(await api.get('/feed/reels'+query,user).expect(200)).body;
 it('does not count delivery or prefetch as an impression or watch',async()=>{
  await fixture(a,5);const p=await page('?limit=3');
  await page('?cursor='+encodeURIComponent(p.nextCursor)+'&limit=3');
  const [counts]=await db.query('SELECT (SELECT count(*) FROM reel_watch_history)::int history,(SELECT count(*) FROM reel_recommendation_impressions WHERE exposed_at IS NOT NULL)::int exposed');
  expect(counts).toEqual({history:0,exposed:0});
 });
 it('does not immediately recommend the exact newly liked video before unseen alternatives',async()=>{
  const [liked]=await fixture(a),alternatives=await fixture(b,3,'#music',86400*30);
  await api.post('/posts/'+liked+'/like',undefined,viewer).expect(200);
  const p=await page('?limit=1');expect(alternatives).toContain(p.items[0].id);
 });
 const activate=async(p:any,e:any,impression=false)=>{
  if(impression)await db.query("UPDATE reel_recommendation_impressions SET delivered_at=now()-interval '2 seconds' WHERE session_id=$1 AND position=$2",[p.sessionId,e.position]);
  return (await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:e.postId,position:e.position,prepare:!impression,...(impression?{visibleMs:750}:{})},viewer).expect(200)).body;
 };
 const event=(p:any,e:any,sequence:number,type:string,watchedMs=0,positionMs=0,durationMs=10000)=>api.post('/feed/reels/watch',{sessionId:p.sessionId,events:[{postId:e.postId,position:e.position,sequence,type,watchedMs,positionMs,durationMs}]},viewer);
 const elapsed=(p:any,e:any,ms:number)=>db.query("UPDATE reel_recommendation_impressions SET last_event_at=now()-$3*interval '1 millisecond' WHERE session_id=$1 AND position=$2",[p.sessionId,e.position,ms]);
 it('uses actual hashtag affinity to boost similar unseen content without requeuing liked sources',async()=>{
  const sources=await fixture(a,3,'#travel'),[similar]=await fixture(b,1,'#travel'),[unrelated]=await fixture(b,1,'#cooking');
  await db.query("UPDATE posts SET created_at=now()-interval '1 hour' WHERE id=ANY($1::uuid[])",[[...sources,similar,unrelated]]);
  for(const source of sources)await api.post('/posts/'+source+'/like',undefined,viewer).expect(200);
  const p=await page('?limit=2');
  expect(p.items.map((x:any)=>x.id)).toEqual([similar,unrelated]);
 });
 it('distinguishes foreground impression, play start, completion and native replay on an exact occurrence',async()=>{
  await fixture(a,2);const p=await page('?limit=4'),entry=p.entries[0];
  await event(p,entry,1,'VIDEO_START').expect(404); // delivered/preloaded is not active playback
  await activate(p,entry,true);
  let [h]=await db.query('SELECT * FROM reel_watch_history WHERE user_id=$1 AND post_id=$2',[viewer.id,entry.postId]);
  expect(h.impression_count).toBe(1);expect(h.first_started_at).toBeNull();expect(h.meaningful_at).toBeNull();
  await event(p,entry,1,'VIDEO_START').expect(204);await elapsed(p,entry,9000);
  await event(p,entry,2,'VIDEO_COMPLETE',9000,9000).expect(204);
  await event(p,entry,3,'VIDEO_REPLAY').expect(204);await event(p,entry,4,'VIDEO_SKIP').expect(204);
  await activate(p,entry,true); // backward navigation must not register a fresh exposure
  [h]=await db.query('SELECT * FROM reel_watch_history WHERE user_id=$1 AND post_id=$2',[viewer.id,entry.postId]);
  expect(h.impression_count).toBe(1);expect(h.first_started_at).not.toBeNull();expect(h.meaningful_at).not.toBeNull();expect(h.completion_count).toBe(1);expect(h.replay_count).toBe(1);expect(h.skip_count).toBe(0);
  const rows=await db.query('SELECT position,started_at FROM reel_recommendation_impressions WHERE session_id=$1 AND post_id=$2',[p.sessionId,entry.postId]);
  expect(rows.filter((x:any)=>x.started_at).map((x:any)=>x.position)).toEqual([entry.position]);
 });
 it('rejects premature impressions, forged positions and unsupported media',async()=>{
  await fixture(a,2);const p=await page('?limit=2'),e=p.entries[0];
  await db.query('UPDATE reel_recommendation_impressions SET delivered_at=now() WHERE session_id=$1',[p.sessionId]);
  await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:e.postId,position:e.position,visibleMs:750},viewer).expect(400);
  await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:e.postId,position:99999,prepare:true},viewer).expect(404);
  await db.query("UPDATE media SET status='FAILED' WHERE id=(SELECT media_id FROM post_media WHERE post_id=$1)",[e.postId]);
  const next=await page('?session='+p.sessionId);expect(next.items.some((x:any)=>x.id===e.postId)).toBe(false);
 });
 it('applies longer meaningful thresholds to long videos and counts early skips only once',async()=>{
  await fixture(a,2);const p=await page('?limit=2'),e=p.entries[0];
  await db.query('UPDATE media SET duration_ms=120000 WHERE id=(SELECT media_id FROM post_media WHERE post_id=$1)',[e.postId]);
  await activate(p,e);await event(p,e,1,'VIDEO_START',0,0,120000).expect(204);
  await elapsed(p,e,3000);await event(p,e,2,'WATCH_MILESTONE',3000,3000,120000).expect(204);
  let [h]=await db.query('SELECT meaningful_at FROM reel_watch_history WHERE post_id=$1',[e.postId]);expect(h.meaningful_at).toBeNull();
  await elapsed(p,e,5000);await event(p,e,3,'WATCH_MILESTONE',5000,8000,120000).expect(204);
  [h]=await db.query('SELECT meaningful_at FROM reel_watch_history WHERE post_id=$1',[e.postId]);expect(h.meaningful_at).not.toBeNull();
  const quick=p.entries[1];await activate(p,quick);await event(p,quick,1,'VIDEO_START').expect(204);await event(p,quick,2,'VIDEO_SKIP').expect(204);await event(p,quick,3,'VIDEO_SKIP').expect(204);
  const [skipped]=await db.query('SELECT skip_count FROM reel_watch_history WHERE post_id=$1',[quick.postId]);expect(skipped.skip_count).toBe(1);
 });
 it('relaxes soft cooldowns after exhaustion, prefers least recent content and preserves hard feedback',async()=>{
  const library=await fixture(a,5);
  await db.query("INSERT INTO reel_watch_history(user_id,post_id,watched_ms,duration_ms,meaningful_at,last_exposed_at) SELECT $1,id,9000,10000,now()-ord*interval '1 minute',now()-ord*interval '1 minute' FROM unnest($2::uuid[]) WITH ORDINALITY x(id,ord)",[viewer.id,library]);
  await api.post('/posts/'+library[0]+'/bookmark',undefined,viewer).expect(200);
  await api.post('/feed/reels/feedback',{postId:library[1],notInterested:true},viewer).expect(204);
  const p=await page('?limit=4');expect(p.entries.every((e:any)=>e.cycle===2)).toBe(true);expect(p.items[0].id).toBe(library[4]);expect(p.items[3].id).toBe(library[0]);expect(p.items.some((x:any)=>x.id===library[1])).toBe(false);
  expect(p.hasMore).toBe(true);
  await api.post('/feed/reels/feedback',{postId:library[1],notInterested:false},viewer).expect(204);
  expect((await page('?limit=5')).items.some((x:any)=>x.id===library[1])).toBe(true);
 });
 it('keeps concurrent page retries immutable, cycle entries unique and two device queues independent',async()=>{
  await fixture(a,5);const first=await page('?limit=2');
  const query='?cursor='+encodeURIComponent(first.nextCursor)+'&limit=2';
  const pages=await Promise.all([page(query),page(query),page(query)]);
  expect(pages[0].entries).toEqual(pages[1].entries);expect(pages[0].entries).toEqual(pages[2].entries);
  const other=await page('?limit=2');expect(other.sessionId).not.toBe(first.sessionId);
  expect(other.entries[0].key).not.toBe(first.entries[0].key);
  const duplicates=await db.query('SELECT session_id,cycle,post_id FROM reel_recommendation_impressions GROUP BY session_id,cycle,post_id HAVING count(*)>1');expect(duplicates).toEqual([]);
 });
 it('preserves history on refresh and makes new uploads available in an active session',async()=>{
  await fixture(a,3);const p=await page('?limit=1'),e=p.entries[0];await activate(p,e,true);
  const retry=await page('?session='+p.sessionId+'&limit=1');expect(retry.entries).toEqual(p.entries);
  const [fresh]=await fixture(b);const next=await page('?cursor='+encodeURIComponent(p.nextCursor)+'&limit=10');expect(next.items.some((x:any)=>x.id===fresh)).toBe(true);
  const [h]=await db.query('SELECT impression_count FROM reel_watch_history WHERE post_id=$1',[e.postId]);expect(h.impression_count).toBe(1);
 });
 it('keeps every stored ranking score normalized, with bounded SQL candidates',async()=>{
  await fixture(a,1200);await fixture(b,300);
  const queries:{sql:string;parameters:any[]}[]=[];const spy=vi.spyOn(db.logger,'logQuery').mockImplementation((sql,parameters)=>{queries.push({sql,parameters:parameters??[]});});
  try{await page('?limit=15');}finally{spy.mockRestore();}
  const rank=queries.find(x=>x.sql.startsWith('WITH recent AS'))!;
  const plan=(await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+rank.sql,rank.parameters))[0]['QUERY PLAN'][0];
  expect(plan.Plan['Actual Rows']).toBeLessThanOrEqual(320);expect(plan['Execution Time']).toBeLessThan(2000);
  const [scores]=await db.query('SELECT min(score)::float low,max(score)::float high FROM reel_recommendation_impressions');expect(scores.low).toBeGreaterThanOrEqual(0);expect(scores.high).toBeLessThanOrEqual(1);
  console.log(`V2 query: ${plan.Plan['Actual Rows']} bounded candidates from 1500 videos; ${plan['Execution Time'].toFixed(2)}ms`);
 });

 it('rolls the V2 migration down/up without deleting users, posts, media or meaningful history',async()=>{
  await fixture(a);const p=await page(),e=p.entries[0];await activate(p,e);await event(p,e,1,'VIDEO_START').expect(204);
  const q=db.createQueryRunner();await q.connect();await q.startTransaction();
  try{
   const snapshot=()=>q.query('SELECT (SELECT count(*) FROM users)::int users,(SELECT count(*) FROM posts)::int posts,(SELECT count(*) FROM media)::int media,(SELECT count(*) FROM reel_watch_history)::int history');
   const before=await snapshot(),migration=new ReelSmartState1760191100000();await migration.down(q);expect(await snapshot()).toEqual(before);await migration.up(q);expect(await snapshot()).toEqual(before);
  }finally{await q.rollbackTransaction();await q.release();}
 });

 it('tracks an explicit profile/direct view of an allocated but undelivered entry without a fake impression',async()=>{
  await fixture(a,3);const p=await page('?limit=1');
  const [other]=await db.query('SELECT post_id,position FROM reel_recommendation_impressions WHERE session_id=$1 AND delivered_at IS NULL ORDER BY position LIMIT 1',[p.sessionId]);
  const e={postId:other.post_id,position:other.position};
  await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:e.postId,prepare:true},viewer).expect(200);
  const [state]=await db.query('SELECT delivered_at,activated_at,exposed_at FROM reel_recommendation_impressions WHERE session_id=$1 AND position=$2',[p.sessionId,e.position]);
  expect(state.delivered_at).not.toBeNull();expect(state.activated_at).not.toBeNull();expect(state.exposed_at).toBeNull();
  await event(p,e,1,'VIDEO_START').expect(204);await activate(p,e,true);
  const [h]=await db.query('SELECT impression_count,first_started_at FROM reel_watch_history WHERE post_id=$1',[e.postId]);expect(h.impression_count).toBe(1);expect(h.first_started_at).not.toBeNull();
 });

});
