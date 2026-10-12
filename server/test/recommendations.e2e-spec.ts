import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { ReelRecommendations1760190400000 } from '../src/database/migrations/1760190400000-ReelRecommendations.js';

describe('Persistent recommendations and attachment classification (e2e)',()=>{
  let app:INestApplication,api:Api,db:DataSource,viewer:TestUser,a:TestUser,b:TestUser;
  beforeAll(async()=>{app=await createTestApp();api=new Api(app);db=app.get(DataSource);});
  beforeEach(async()=>{await resetDatabase(app);viewer=await api.register('viewer');a=await api.register('creator');b=await api.register('other');});
  afterAll(()=>app.close());
  // SQL fixtures are isolated to *_test; no sample content is added to Circle's real database.
  async function fixture(user:TestUser,type:'VIDEO'|'IMAGE'|null='VIDEO',count=1,status='READY') {
    const ids=Array.from({length:count},()=>randomUUID()), media=ids.map(()=>randomUUID());
    await db.query(`INSERT INTO posts(id,author_id,content,created_at) SELECT id,$2,'fixture discovery',now()-ord*interval '1 second' FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)`,[ids,user.id]);
    if(type) {
      await db.query(`INSERT INTO media(id,owner_id,type,status,storage_key,mime_type,size_bytes,width,height,duration_ms)
        SELECT id,$2,$3,$4,'test-reel/'||id,$5,10,1080,1920,$6 FROM unnest($1::uuid[]) id`,[media,user.id,type,status,type==='VIDEO'?'video/mp4':'image/gif',type==='VIDEO'?10000:null]);
      await db.query(`INSERT INTO post_media(post_id,media_id,position) SELECT post,media,0 FROM unnest($1::uuid[],$2::uuid[]) x(post,media)`,[ids,media]);
    }
    return ids;
  }
  const page=async(query='',user:TestUser|undefined=viewer)=>(await api.get('/feed/reels'+query,user).expect(200)).body;
  const ids=(p:any)=>p.items.map((x:any)=>x.id);
  const watch=(sessionId:string,postId:string,sequence:number,type:string,watchedMs=0,positionMs=0,durationMs=10000,user:TestUser|undefined=viewer)=>
    api.post('/feed/reels/watch',{sessionId,events:[{postId,sequence,type,watchedMs,positionMs,durationMs}]},user);
  async function elapsed(sessionId:string,postId:string,ms=5000) {await db.query(`UPDATE reel_recommendation_impressions SET last_event_at=now()-$3*interval '1 millisecond' WHERE session_id=$1 AND post_id=$2`,[sessionId,postId,ms]);}

  it('classifies text, animated images, mixed/processing video and referenced content on the server',async()=>{
    const [text]=await fixture(a,null),[image]=await fixture(a,'IMAGE'),[video]=await fixture(a),[processing]=await fixture(a,'VIDEO',1,'PROCESSING');
    const extra=randomUUID();await db.query(`INSERT INTO media(id,owner_id,type,status,storage_key,mime_type,size_bytes) VALUES($1::uuid,$2,'IMAGE','READY',($1::uuid)::text,'image/png',10)`,[extra,a.id]);
    await db.query('INSERT INTO post_media VALUES($1,$2,1)',[video,extra]);
    await api.post(`/posts/${video}/repost`,undefined,b).expect(200);
    const photoRepost=(await api.post(`/posts/${image}/repost`,undefined,b).expect(200)).body;
    const quote=(await api.post(`/posts/${video}/quote`,{content:'video quote'},b).expect(201)).body;
    await api.post(`/users/${b.id}/follow`,undefined,viewer).expect(200);
    const home=(await api.get('/feed/global',viewer).expect(200)).body;
    expect(new Set(ids(home))).toEqual(new Set([text,image]));
    const followed=(await api.get('/feed/following',viewer).expect(200)).body;
    expect(ids(followed)).toContain(photoRepost.repostId);expect(ids(followed)).not.toContain(quote.id);
    expect(ids(await page())).toEqual([video]);
    const profile=(await api.get(`/users/${a.id}/posts?content=home`,viewer).expect(200)).body;
    expect(new Set(ids(profile))).toEqual(new Set([text,image]));
    const profileVideos=(await api.get(`/users/${a.id}/posts?content=reels`,viewer).expect(200)).body;
    // A post whose video is still compressing stays hidden until the video is ready.
    expect(new Set(ids(profileVideos))).toEqual(new Set([video]));
    expect(ids(profileVideos)).not.toContain(processing);
    expect(ids((await api.get('/feed/global?content=all',viewer).expect(200)).body)).toContain(video);
  });

  it('discovers all 105 videos across ranked windows with no repeat, stable retries and creator diversity',async()=>{
    const library=[...await fixture(a,'VIDEO',75),...await fixture(b,'VIDEO',30)];
    let p=await page('?limit=15');
    const session=p.sessionId,first=ids(p),entries:{postId:string;cycle:number;key:string}[]=[],creators:string[]=[];
    expect(ids(await page(`?session=${session}&limit=15`))).toEqual(first);
    for(let guard=0;guard<30 && !entries.some(e=>e.cycle===3);guard++) {
      expect(p.entries.map((e:any)=>e.postId)).toEqual(ids(p));
      entries.push(...p.entries);creators.push(...p.items.map((x:any)=>x.author.id));
      expect(p.hasMore).toBe(true);
      const retry=await page(`?cursor=${encodeURIComponent(p.nextCursor)}&limit=15`);
      p=await page(`?cursor=${encodeURIComponent(p.nextCursor)}&limit=15`);expect(ids(p)).toEqual(ids(retry));
    }
    const cycle=(n:number)=>entries.filter(e=>e.cycle===n).map(e=>e.postId);
    // Every eligible Reel exactly once per cycle; cycles follow each other without a gap.
    for(const n of [1,2]) {expect(cycle(n)).toHaveLength(105);expect(new Set(cycle(n))).toEqual(new Set(library));}
    expect(entries.findIndex(e=>e.cycle===2)).toBe(105);expect(entries.findIndex(e=>e.cycle===3)).toBe(210);
    expect(new Set(entries.map(e=>e.key)).size).toBe(entries.length);
    expect(cycle(2)).not.toEqual(cycle(1)); // reshuffled, not the old order again
    for(let i=1;i<entries.length;i++)expect(entries[i].postId).not.toBe(entries[i-1].postId);
    // Cycle boundaries never open with the Reels shown last.
    for(const at of [105,210])expect(entries.slice(at-3,at).map(e=>e.postId)).not.toContain(entries[at].postId);
    // A surplus creator may finish alone after all alternative creators have been exhausted.
    const firstCycle=creators.slice(0,105),lastOther=firstCycle.lastIndexOf(b.id);
    for(let i=2;i<lastOther;i++)expect(firstCycle.slice(i-2,i+1).every(x=>x===firstCycle[i])).toBe(false);
    expect(ids(await page(`?session=${session}&limit=15`))).toEqual(first); // backward/refetch history
  });

  it('persists meaningful viewing across sessions and only explicitly permits Watch again',async()=>{
    const [post]=await fixture(a);const p=await page();
    await watch(p.sessionId,post,1,'VIDEO_START').expect(204);
    expect(ids(await page())).toContain(post); // one accidental frame is not consumed
    await elapsed(p.sessionId,post);
    await watch(p.sessionId,post,2,'WATCH_MILESTONE',2200,2200).expect(204);
    const [history]=await db.query('SELECT * FROM reel_watch_history WHERE user_id=$1 AND post_id=$2',[viewer.id,post]);
    expect(history.meaningful_at).not.toBeNull();expect(Number(history.watched_ms)).toBe(2200);
    // Not offered as unwatched again; it comes back in the rediscovery cycle. A single Reel is served
    // once (the player loops it) instead of an endless list of copies.
    const again=await page();
    expect(again.entries).toEqual([{key:`2:${post}`,postId:post,cycle:2}]);expect(again.hasMore).toBe(false);expect(again.nextCursor).toBeNull();
    expect((await page('?rewatch=true')).entries).toEqual([{key:`1:${post}`,postId:post,cycle:1}]);
    const [kept]=await db.query('SELECT * FROM reel_watch_history WHERE user_id=$1 AND post_id=$2',[viewer.id,post]);
    expect(Number(kept.watched_ms)).toBe(2200);expect(kept.meaningful_at).not.toBeNull();
    expect(ids(await page(`?session=${p.sessionId}`))).toEqual([post]); // delivered history remains navigable
  });

  it('validates playback data, clamps impossible watch time, and ignores duplicate sequences',async()=>{
    const [post]=await fixture(a);const p=await page();
    await watch(p.sessionId,post,1,'WATCH_MILESTONE',1000,1000).expect(400);
    await watch(p.sessionId,post,1,'VIDEO_START',0,0,90000).expect(400);
    await watch(p.sessionId,post,1,'VIDEO_START').expect(204);
    await watch(p.sessionId,post,2,'WATCH_MILESTONE',15000,1000).expect(204);
    let [h]=await db.query('SELECT * FROM reel_watch_history WHERE post_id=$1',[post]);expect(Number(h.watched_ms)).toBeLessThan(2000);expect(h.meaningful_at).toBeNull();
    const previous=Number(h.watched_ms);
    await watch(p.sessionId,post,2,'WATCH_MILESTONE',15000,1000).expect(204);
    [h]=await db.query('SELECT * FROM reel_watch_history WHERE post_id=$1',[post]);expect(Number(h.watched_ms)).toBe(previous);
    await watch(p.sessionId,post,3,'VIDEO_COMPLETE',16000,10000).expect(400);
    await watch(p.sessionId,post,3,'VIDEO_COMPLETE',0,20000).expect(400);
    expect(ids(await page())).toContain(post);
  });

  it('records completion/replay and short-video thresholds separately from quick skips',async()=>{
    const [post]=await fixture(a);await db.query('UPDATE media SET duration_ms=1000 WHERE id=(SELECT media_id FROM post_media WHERE post_id=$1)',[post]);
    const p=await page();
    await watch(p.sessionId,post,1,'VIDEO_START',0,0,1000).expect(204);
    await elapsed(p.sessionId,post,1000);
    await watch(p.sessionId,post,2,'VIDEO_COMPLETE',950,950,1000).expect(204);
    await watch(p.sessionId,post,3,'VIDEO_REPLAY',0,0,1000).expect(204);
    await watch(p.sessionId,post,4,'VIDEO_REPLAY',0,0,1000).expect(204);
    const [h]=await db.query('SELECT * FROM reel_watch_history WHERE post_id=$1',[post]);
    expect(h.meaningful_at).not.toBeNull();expect(h.completion_count).toBe(1);expect(h.replay_count).toBe(1);
    expect((await page()).entries.map((e:any)=>e.cycle)).toEqual([2]);
  });

  it('binds authenticated cursors to the viewer and rejects tampering or expired sessions',async()=>{
    await fixture(a,'VIDEO',3);const p=await page('?limit=1');
    await api.get(`/feed/reels?cursor=${p.nextCursor}`,b).expect(400);
    await api.get(`/feed/reels?cursor=${p.nextCursor.slice(0,-3)}abc`,viewer).expect(400);
    await api.get(`/feed/reels?session=${randomUUID()}`,viewer).expect(400);
    await api.get('/feed/reels?rewatch=anything',viewer).expect(400);
    await db.query(`UPDATE reel_recommendation_sessions SET expires_at=now()-interval '1 second' WHERE id=$1`,[p.sessionId]);
    await api.get(`/feed/reels?cursor=${p.nextCursor}`,viewer).expect(400);
  });

  it('supports temporary guest state without creating persistent user watch history',async()=>{
    const [post]=await fixture(a);const p=(await api.get('/feed/reels').expect(200)).body;
    await api.post('/feed/reels/watch',{sessionId:p.sessionId,events:[{postId:post,sequence:1,type:'VIDEO_START',watchedMs:0,positionMs:0,durationMs:10000}]}).expect(204);
    expect((await db.query('SELECT * FROM reel_watch_history')).length).toBe(0);
    await api.get(`/feed/reels?session=${p.sessionId}`,viewer).expect(400);
    expect(ids((await api.get(`/feed/reels?session=${p.sessionId}`).expect(200)).body)).toEqual([post]);
  });

  it('filters feedback, reports, privacy, deletion and blocks even on previously allocated pages',async()=>{
    const library=await fixture(a,'VIDEO',5);await fixture(b);
    const p=await page('?limit=1');
    await api.post('/feed/reels/feedback',{postId:library[0],notInterested:true},viewer).expect(204);
    await api.post('/reports',{targetType:'POST',targetId:library[1],reason:'SPAM'},viewer).expect(201);
    await db.query(`UPDATE posts SET deleted_at=now() WHERE id=$1`,[library[2]]);
    let refreshed=await page(`?session=${p.sessionId}`);
    for(const id of library.slice(0,3))expect(ids(refreshed)).not.toContain(id);
    await api.patch('/users/me',{isPrivate:true},a).expect(200);
    refreshed=await page(`?session=${p.sessionId}`);expect(refreshed.items.every((x:any)=>x.author.id!==a.id)).toBe(true);
    await api.post(`/users/${b.id}/block`,undefined,viewer).expect(200);
    expect(ids(await page(`?session=${p.sessionId}`))).toEqual([]);
    await api.post('/feed/reels/feedback',{postId:library[3],notInterested:true}).expect(401);
  });

  it('uses actual follow and bookmark signals while keeping cold-start and small libraries usable',async()=>{
    const [one]=await fixture(a),[two]=await fixture(b);
    await db.query('UPDATE posts SET created_at=now()-interval \'1 hour\' WHERE id=ANY($1::uuid[])',[[one,two]]);
    await api.post(`/users/${a.id}/follow`,undefined,viewer).expect(200);
    await api.post(`/posts/${one}/bookmark`,undefined,viewer).expect(200);
    expect(ids(await page())[0]).toBe(one);
    const small=await page('',b);
    expect(new Set(ids(small).slice(0,2))).toEqual(new Set([one,two]));
    for(let i=1;i<small.entries.length;i++)expect(small.entries[i].postId).not.toBe(small.entries[i-1].postId);
    expect(small.hasMore).toBe(true);
    expect(new Set(ids(await page()))).toEqual(new Set([one,two]));
  });

  it('keeps the discovery snapshot stable and supports exact deep links without resetting history',async()=>{
    const old=await fixture(a,'VIDEO',3),p=await page('?limit=1');
    const [fresh]=await fixture(b);await db.query('UPDATE posts SET created_at=now() WHERE id=$1',[fresh]);
    await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:old[2]},viewer).expect(200);
    const next=await page(`?cursor=${encodeURIComponent(p.nextCursor)}`);
    // The new upload becomes eligible in the running session; nothing already served is repeated in cycle 1.
    const cycleOne=next.entries.filter((e:any)=>e.cycle===1).map((e:any)=>e.postId);
    expect(cycleOne).toContain(fresh);expect(cycleOne).not.toContain(ids(p)[0]);expect(new Set(cycleOne).size).toBe(cycleOne.length);
    expect(ids(await page())).toContain(fresh);
    await api.post('/feed/reels/expose',{sessionId:p.sessionId,postId:randomUUID()},viewer).expect(404);
    await api.post(`/users/${a.id}/block`,undefined,viewer).expect(200);
    await watch(p.sessionId,old[2],1,'VIDEO_START').expect(404);
  });

  it('validates reversible migration while preserving existing users, posts and media',async()=>{
    await fixture(a);const q=db.createQueryRunner();await q.connect();await q.startTransaction();
    try {
      const before=await q.query('SELECT (SELECT count(*) FROM users)::int users,(SELECT count(*) FROM posts)::int posts,(SELECT count(*) FROM media)::int media');
      const migration=new ReelRecommendations1760190400000();await migration.down(q);
      expect(await q.query('SELECT (SELECT count(*) FROM users)::int users,(SELECT count(*) FROM posts)::int posts,(SELECT count(*) FROM media)::int media')).toEqual(before);
      await migration.up(q);expect((await q.query(`SELECT tablename FROM pg_tables WHERE tablename LIKE 'reel_%'`)).length).toBe(4);
      expect((await q.query(`SELECT indexname FROM pg_indexes WHERE indexname='ix_posts_reel_candidates'`)).length).toBe(1);
    } finally {await q.rollbackTransaction();await q.release();}
  });
  it('bounds candidate queries and validates their PostgreSQL execution plan',async()=>{
    await fixture(a,'VIDEO',360);await fixture(b,'VIDEO',120);
    const queries:{sql:string;parameters:any[]}[]=[];
    const spy=vi.spyOn(db.logger,'logQuery').mockImplementation((sql,parameters)=>{queries.push({sql,parameters:parameters??[]});});
    try {expect((await page('?limit=15')).items).toHaveLength(15);} finally {spy.mockRestore();}
    const ranked=queries.find(q=>q.sql.startsWith('WITH recent AS'));expect(ranked).toBeDefined();
    expect(queries.length).toBeLessThan(30);expect(ranked!.sql).toContain('LIMIT 320');
    const plan=await db.query('EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) '+ranked!.sql,ranked!.parameters);
    const result=plan[0]['QUERY PLAN'][0];expect(result.Plan['Actual Rows']).toBeLessThanOrEqual(320);
    expect(result['Execution Time']).toBeLessThan(2000); // generous ceiling for shared CI hardware
    console.log(`Recommendation plan: ${result.Plan['Actual Rows']} candidates, ${result['Execution Time'].toFixed(1)}ms, ${queries.length} SQL queries for page+hydration`);
  });
});
