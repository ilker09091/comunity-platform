import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { STORAGE_DRIVER, type StorageDriver } from '../src/modules/media/storage/storage.driver.js';
import { appConfig } from '../src/config/app.config.js';

describe('Calls, streaks, block privacy and account erasure',()=>{
  let app:INestApplication,api:Api,db:DataSource,a:TestUser,b:TestUser,c:TestUser;
  let ad:string,bd:string;
  beforeAll(async()=>{app=await createTestApp();api=new Api(app);db=app.get(DataSource);});
  beforeEach(async()=>{await resetDatabase(app);a=await api.register('caller');b=await api.register('callee');c=await api.register('other');ad=randomUUID();bd=randomUUID();});
  afterAll(()=>app?.close());
  const allow=async()=>{await api.post(`/users/${a.id}/follow`,{},b).expect(200);await api.post(`/users/${b.id}/follow`,{},a).expect(200);};
  const start=async(kind='audio')=>(await api.post('/calls',{peerId:b.id,kind,deviceId:ad},a).expect(201)).body;
  const action=(id:string,who:TestUser,deviceId:string,value:string)=>api.post(`/calls/${id}/action`,{deviceId,action:value},who);

  it('requires authentication, validates input and prevents unsolicited calls',async()=>{
    await api.get(`/calls/current?deviceId=${ad}`).expect(401);
    await api.post('/calls',{peerId:a.id,kind:'audio',deviceId:ad},a).expect(400);
    await api.post('/calls',{peerId:b.id,kind:'video',deviceId:ad},a).expect(403);
    await api.post(`/messages/${b.id}`,{content:'May I call?'},a).expect(201);
    await api.post('/calls',{peerId:b.id,kind:'video',deviceId:ad},a).expect(403);
    await api.post(`/messages/${a.id}/accept`,{},b).expect(204);
    expect((await start('video')).peer.username).toBe(b.username);
  });
  it('claims the answering device, orders signals and isolates other accounts/tabs',async()=>{
    await allow();const call=await start();
    expect((await api.get(`/calls/current?deviceId=${bd}`,b)).body.call.id).toBe(call.id);
    await api.get(`/calls/${call.id}?deviceId=${randomUUID()}`,c).expect(404);
    await action(call.id,b,bd,'accept').expect(200);
    await action(call.id,b,randomUUID(),'accept').expect(409);
    await api.post(`/calls/${call.id}/signals`,{deviceId:randomUUID(),kind:'ice',payload:'{"candidate":"candidate:1"}'},a).expect(403);
    await api.post(`/calls/${call.id}/signals`,{deviceId:ad,kind:'description',payload:JSON.stringify({type:'offer',sdp:'v=0\r\n'})},a).expect(204);
    const response=(await api.get(`/calls/${call.id}?deviceId=${bd}`,b).expect(200)).body;
    expect(response.signals).toHaveLength(1);
    expect((await api.get(`/calls/${call.id}?deviceId=${bd}&after=${response.cursor}`,b)).body.signals).toHaveLength(0);
    await action(call.id,a,ad,'end').expect(200);
    expect((await api.get(`/calls/${call.id}?deviceId=${bd}`,b)).body.call.state).toBe('ended');
    await api.post(`/calls/${call.id}/signals`,{deviceId:ad,kind:'ice',payload:'{"candidate":"x"}'},a).expect(403);
  });
  it('serializes crossing calls and makes timeout/rejection release both participants',async()=>{
    await allow();
    const responses=await Promise.all([api.post('/calls',{peerId:b.id,kind:'audio',deviceId:ad},a),api.post('/calls',{peerId:a.id,kind:'audio',deviceId:bd},b)]);
    expect(responses.map(r=>r.status).sort((x,y)=>x-y)).toEqual([201,409]);
    await db.query(`UPDATE calls SET created_at=now()-interval '61 seconds'`);
    expect((await api.get(`/calls/current?deviceId=${ad}`,a)).body.call).toBeNull();
    const next=await start();await action(next.id,b,bd,'reject').expect(200);
    expect((await api.get(`/calls/${next.id}?deviceId=${ad}`,a)).body.call.endReason).toBe('declined');
    const live=await start();await action(live.id,b,bd,'accept').expect(200);
    await db.query(`UPDATE calls SET callee_seen_at=now()-interval '46 seconds' WHERE id=$1`,[live.id]);
    expect((await api.get(`/calls/${live.id}?deviceId=${ad}`,a)).body.call.state).toBe('ended');
  });
  it('drops each finished call into the conversation once, with its outcome and length, without streak credit',async()=>{
    await allow();
    const talk=await start('video');await action(talk.id,b,bd,'accept').expect(200);
    await db.query(`UPDATE calls SET accepted_at=now()-interval '125 seconds' WHERE id=$1`,[talk.id]);
    await action(talk.id,a,ad,'end').expect(200);await action(talk.id,a,ad,'end').expect(200);
    const declined=await start();await action(declined.id,b,bd,'reject').expect(200);
    const cancelled=await start();await action(cancelled.id,a,ad,'end').expect(200);
    await start();await db.query(`UPDATE calls SET created_at=now()-interval '61 seconds' WHERE state='ringing'`);
    expect((await api.get(`/calls/current?deviceId=${bd}`,b)).body.call).toBeNull();
    const items=(await api.get(`/messages/${a.id}?limit=10`,b).expect(200)).body.items.reverse();
    expect(items.map((m:any)=>m.call)).toEqual([
      {kind:'video',status:'completed',durationSeconds:125},
      {kind:'audio',status:'declined',durationSeconds:null},
      {kind:'audio',status:'cancelled',durationSeconds:null},
      {kind:'audio',status:'missed',durationSeconds:null},
    ]);
    expect(items.every((m:any)=>m.senderId===a.id&&m.content===null)).toBe(true);
    // Only missed/cancelled calls wait for the callee; none of them counts toward a streak.
    expect((await api.get('/messages/unread-count',b).expect(200)).body.count).toBe(2);
    await api.post(`/messages/${a.id}`,{content:'Call me later',replyToId:items[0].id},b).expect(201);
    expect((await api.get(`/messages/${a.id}?limit=1`,b)).body.items[0].replyTo.kind).toBe('CALL');
    expect((await db.query('SELECT low_sent_day IS NULL OR high_sent_day IS NULL AS partial FROM message_streaks'))[0].partial).toBe(true);
  });
  it('hides blocked profiles, closes calls and keeps historical messages in the database',async()=>{
    await allow();await api.post(`/messages/${b.id}`,{content:'Old message'},a).expect(201);
    const call=await start();await action(call.id,b,bd,'accept').expect(200);
    await api.post(`/users/${a.id}/block`,{},b).expect(200);
    const profile=await api.get(`/users/${b.username}`,a).expect(404);expect(profile.body.code).toBe('USER_NOT_FOUND');
    await api.post(`/messages/${b.id}`,{content:'Blocked'},a).expect(404);
    await api.post('/calls',{peerId:b.id,kind:'audio',deviceId:ad},a).expect(404);
    const ended=(await api.get(`/calls/${call.id}?deviceId=${ad}`,a)).body.call;
    expect(ended.state).toBe('ended');expect(ended.peer.avatarUrl).toBeNull();expect(ended.peer.username).toBe('');
    expect((await db.query('SELECT count(*)::int n FROM direct_messages'))[0].n).toBe(1);
    expect((await db.query('SELECT state FROM calls WHERE id=$1',[call.id]))[0].state).toBe('ended');
    const history=(await api.get(`/messages/${b.id}`,a).expect(200)).body;
    expect(history.items[0].content).toBe('Old message');
    const identity=(await api.get(`/messages/peer/${b.username}`,a).expect(200)).body;
    expect(identity).toMatchObject({id:b.id,isUnavailable:true,isBlocking:false,displayName:'Circle user',avatarUrl:null});
    expect(identity).not.toHaveProperty('bio');
    expect((await api.get(`/messages/${b.id}/status`,a)).body).toMatchObject({isUnavailable:true,canSend:false,peerOnline:false,peerTyping:false,peerLastActiveAt:null});
    expect((await api.get('/messages',a)).body.items[0]).toMatchObject({isUnavailable:true,unreadCount:0,user:{avatarUrl:null}});
    await api.post(`/users/${c.id}/block`,{},b).expect(200);
    await api.get(`/messages/peer/${b.username}`,c).expect(404);
    await api.get(`/messages/${b.id}`,c).expect(404);
  });
  it('blocking removes the blocked account interactions and unblocking does not restore them',async()=>{
    await allow();await api.post(`/messages/${b.id}`,{content:'keep this chat'},a).expect(201);
    await api.post(`/messages/${a.id}`,{content:'old reply'},b).expect(201);
    await api.patch('/users/me',{bio:'Private biography'},a).expect(200);
    const post=await api.createPost(a,{content:'My post'});
    await api.post(`/posts/${post.id}/like`,{},b).expect(200);
    const comment=(await api.post(`/posts/${post.id}/comments`,{content:'Remove my old comment'},b).expect(201)).body;
    await api.post(`/comments/${comment.id}/replies`,{content:'Keep my reply'},c).expect(201);
    await api.post(`/users/${b.id}/block`,{},a).expect(200);
    const mine=(await api.get(`/users/${b.username}`,a)).body;
    expect(mine).toMatchObject({isBlocking:true,canViewContent:false,bio:null,coverUrl:null,followerCount:0,followingCount:0,postCount:0});
    const ownPost=(await api.get(`/posts/${post.id}`,a)).body;
    expect(ownPost.likeCount).toBe(0);expect(ownPost.commentCount).toBe(1);
    expect((await db.query('SELECT content FROM comments WHERE id=$1',[comment.id]))[0].content).toBe('');
    expect((await api.get(`/messages/${b.id}/status`,a)).body).toMatchObject({isBlocking:true,isUnavailable:true,canSend:false});
    await api.delete(`/users/${b.id}/block`,a).expect(200);
    expect((await api.get(`/users/${b.username}`,a)).body).toMatchObject({isFollowing:false,followsYou:false,isBlocking:false});
    expect((await api.get(`/posts/${post.id}`,a)).body).toMatchObject({likeCount:0,commentCount:1});
    expect((await api.get(`/messages/${b.id}/status`,a)).body).toMatchObject({isUnavailable:false,canSend:true});
    await api.post(`/messages/${b.id}`,{content:'after unblock'},a).expect(201);
  });
  it('rejects a send that passed its first permission check before a concurrent block committed',async()=>{
    await allow();
    const lock=db.createQueryRunner();await lock.connect();await lock.startTransaction();
    let send:Promise<{status:number}>|undefined;
    try {
      await lock.query('SELECT pg_advisory_xact_lock(hashtext(least($1::text, $2::text) || greatest($1::text, $2::text)))',[a.id,b.id]);
      send=api.post(`/messages/${b.id}`,{content:'must not slip through'},a).then(response=>response);
      let waiting=false;
      for(let attempt=0;attempt<150;attempt++){
        waiting=!!(await db.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'
          AND query LIKE '%SELECT pg_advisory_xact_lock%'`)).length;
        if(waiting)break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      expect(waiting).toBe(true);
      await api.post(`/users/${a.id}/block`,{},b).expect(200);
      await lock.commitTransaction();
      expect((await send).status).toBe(404);
      expect((await db.query('SELECT count(*)::int n FROM direct_messages'))[0].n).toBe(0);
    } finally {
      if(lock.isTransactionActive)await lock.rollbackTransaction();
      await lock.release();
      await send;
    }
  });
  it('counts reciprocal days once, and an unsend cannot manufacture extra streak days',async()=>{
    await allow();
    for(const offset of [2,1,0]){
      for(const [sender,recipient] of [[a,b],[b,a]])await db.query(`INSERT INTO direct_messages(sender_id,recipient_id,content,created_at) VALUES($1,$2,'daily',(((now() AT TIME ZONE 'UTC')::date-$3::int)+interval '1 hour') AT TIME ZONE 'UTC')`,[sender.id,recipient.id,offset]);
    }
    expect((await api.get(`/messages/${b.id}/streak`,a)).body).toMatchObject({days:3,state:'active',sentToday:true,peerSentToday:true});
    await api.post(`/messages/${b.id}`,{content:'again'},a).expect(201);
    await api.post(`/messages/${a.id}`,{content:'again'},b).expect(201);
    expect((await api.get(`/messages/${b.id}/streak`,a)).body.days).toBe(3);
    await db.query('DELETE FROM direct_messages');
    expect((await api.get(`/messages/${b.id}/streak`,a)).body.days).toBe(3);
  });
  it('restores only within the grace window and a concurrent restore consumes one credit',async()=>{
    await allow();await api.post(`/messages/${b.id}`,{content:'hello'},a).expect(201);
    await db.query(`UPDATE message_streaks SET days=12,last_completed_day=(now() AT TIME ZONE 'UTC')::date-3`);
    expect((await api.get(`/messages/${b.id}/streak`,a)).body.canRestore).toBe(true);
    const res=await Promise.all([api.post(`/messages/${b.id}/streak/restore`,{},a),api.post(`/messages/${a.id}/streak/restore`,{},b)]);
    expect(res.map(r=>r.status).sort((x,y)=>x-y)).toEqual([200,409]);
    expect((await api.get(`/messages/${b.id}/streak`,a)).body).toMatchObject({days:12,restoresRemaining:2});
    await db.query(`UPDATE message_streaks SET last_completed_day=(now() AT TIME ZONE 'UTC')::date-5`);
    await api.post(`/messages/${b.id}/streak/restore`,{},a).expect(409);
  });
  it('deletes the account, sessions and stored media atomically and repairs neighbors counters',async()=>{
    await allow();const admin=await api.register('admin');await api.setRole(admin,'ADMIN');
    const image=await sharp({create:{width:16,height:16,channels:3,background:'#fff'}}).png().toBuffer();
    const media=(await api.http.post('/api/media').set(a.auth).attach('file',image,{filename:'photo.png',contentType:'image/png'}).expect(201)).body;
    await api.createPost(a,{mediaIds:[media.id]});
    const other=await api.createPost(b,{content:'keep'});await api.post(`/posts/${other.id}/like`,{},a).expect(200);
    await api.post(`/messages/${b.id}`,{content:'erase this'},a).expect(201);
    const root=app.get(appConfig.KEY).media.localDir;
    const file=join(root,'.incoming','uploads','audio-'+randomUUID());await mkdir(join(root,'.incoming','uploads'),{recursive:true});await writeFile(file,'private audio');
    await db.query('INSERT INTO audio_uploads(owner_id,path,duration_ms) VALUES($1,$2,15000)',[a.id,file]);
    const body={reason:'Deletion requested',confirmUsername:a.username};
    await api.post(`/admin/users/${a.id}/delete`,body,b).expect(403);
    await api.post(`/admin/users/${a.id}/delete`,body,admin).expect(403);
    const token=(await api.post('/admin/step-up',{password:'password123'},admin)).body.token;
    await api.post(`/admin/users/${a.id}/delete`,{...body,confirmUsername:'wrong'},admin).set('X-Step-Up-Token',token).expect(400);
    await api.post(`/admin/users/${a.id}/delete`,body,admin).set('X-Step-Up-Token',token).expect(200);
    expect(await db.query('SELECT id FROM users WHERE id=$1',[a.id])).toEqual([]);
    expect(await db.query('SELECT id FROM direct_messages')).toEqual([]);
    const storage=app.get<StorageDriver>(STORAGE_DRIVER),key=new URL(media.url).pathname.split('/').at(-1)!;
    expect(await storage.resolve(key)).toBeNull();await expect(stat(file)).rejects.toThrow();
    expect((await api.get(`/posts/${other.id}`,b)).body.likeCount).toBe(0);
    expect((await api.get(`/users/${b.username}`,b)).body.followerCount).toBe(0);
    expect((await db.query("SELECT action FROM admin_audit_logs WHERE action='user.deleted'"))).toHaveLength(1);
    await api.get('/users/me',a).expect(401);
    await api.get(`/users/${a.username}`,b).expect(404);
  });
});
