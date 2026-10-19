import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { ContentDeletionService } from '../src/modules/media/content-deletion.service.js';

describe('DM device receipts, stickers and voice clips',()=>{
  let app:INestApplication,api:Api,db:DataSource,a:TestUser,b:TestUser,c:TestUser;
  beforeAll(async()=>{app=await createTestApp();api=new Api(app);db=app.get(DataSource);});
  beforeEach(async()=>{
    await resetDatabase(app);a=await api.register('audio_a');b=await api.register('audio_b');c=await api.register('audio_c');
    for(const [one,two] of [[a,b],[a,c],[b,c]]){
      await api.post(`/users/${one.id}/follow`,{},two).expect(200);await api.post(`/users/${two.id}/follow`,{},one).expect(200);
    }
  });
  afterAll(()=>app?.close());
  const send=async(content:string)=>(await api.post(`/messages/${b.id}`,{content},a).expect(201)).body;
  const message=async(id:string)=>(await api.get(`/messages/${b.id}`,a)).body.items.find((m:{id:string})=>m.id===id);
  const recording=()=>{
    const data=Buffer.alloc(44+32000);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);
    data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(16000,24);
    data.writeUInt32LE(32000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(32000,40);
    for(let i=0;i<16000;i++)data.writeInt16LE(Math.round(Math.sin(i*Math.PI*2*440/16000)*5000),44+i*2);
    return data;
  };
  const uploadAudio=async()=>(await api.http.post('/api/messages/audio').set(a.auth)
    .attach('file',recording(),{filename:'voice.wav',contentType:'audio/wav'}).expect(201)).body;

  it('requires actual recipient acknowledgment; presence and GETs do not imply delivery',async()=>{
    const first=await send('offline message'),second=await send('second offline message');
    await api.get('/messages/unread-count',b).expect(200);await api.get('/messages',b).expect(200);await api.get(`/messages/${a.id}`,b).expect(200);
    expect(await message(first.id)).toMatchObject({deliveredAt:null,readAt:null});
    expect((await api.get('/messages/delivery',b)).body.messageIds).toEqual([first.id,second.id]);
    await api.post('/messages/delivery',{messageIds:[first.id]},c).expect(204);
    expect((await message(first.id)).deliveredAt).toBeNull();
    await api.post('/messages/delivery',{messageIds:[first.id]},b).expect(204);
    expect((await message(first.id)).deliveredAt).not.toBeNull();
    expect(await message(second.id)).toMatchObject({deliveredAt:null,readAt:null});
    await api.post(`/messages/${second.id}/read`,{},b).expect(204);
    expect((await message(second.id)).readAt).not.toBeNull();expect((await message(second.id)).deliveredAt).not.toBeNull();
    const before=(await message(first.id)).deliveredAt;await api.post('/messages/delivery',{messageIds:[first.id]},b).expect(204);
    expect((await message(first.id)).deliveredAt).toBe(before);
    await api.post('/messages/delivery',{messageIds:['bad']},b).expect(400);await api.get('/messages/delivery').expect(401);
  });
  it('does not acknowledge blocked messages',async()=>{
    const old=await send('before blocking');await api.post(`/users/${a.id}/block`,{},b).expect(200);
    expect((await api.get('/messages/delivery',b)).body.messageIds).toEqual([]);
    await api.post('/messages/delivery',{messageIds:[old.id]},b).expect(204);
    expect((await db.query('SELECT delivered_at FROM direct_messages WHERE id=$1',[old.id]))[0].delivered_at).toBeNull();
  });
  it('supports received custom sticker favorites and reuse without exposing private libraries',async()=>{
    const png=await sharp({create:{width:64,height:64,channels:4,background:{r:30,g:130,b:240,alpha:.6}}}).png().toBuffer();
    const media=(await api.http.post('/api/media').set(a.auth).attach('file',png,{filename:'my.png',contentType:'image/png'}).expect(201)).body;
    const sticker=(await api.post('/stickers',{mediaId:media.id,name:'My sticker'},a).expect(201)).body;
    await api.post(`/stickers/${sticker.id}/favorite`,{},c).expect(404);
    await api.post(`/messages/${a.id}`,{stickerId:sticker.id},c).expect(404);
    const sent=(await api.post(`/messages/${b.id}`,{stickerId:sticker.id},a).expect(201)).body;
    expect(sent).toMatchObject({hasSticker:true,sticker:{id:sticker.id,isOwn:true,isFavorite:false},audioUrl:null});
    expect((await api.get('/stickers',b)).body.some((s:{id:string})=>s.id===sticker.id)).toBe(false);
    await api.post(`/stickers/${sticker.id}/favorite`,{},b).expect(204);
    expect((await api.get('/stickers',b)).body.find((s:{id:string})=>s.id===sticker.id)).toMatchObject({isFavorite:true,isOwn:false});
    await api.delete(`/stickers/${sticker.id}`,a).expect(204);
    expect((await api.post(`/messages/${c.id}`,{stickerId:sticker.id},b).expect(201)).body.sticker.id).toBe(sticker.id);
    await api.delete(`/stickers/${sticker.id}/favorite`,b).expect(204);
    expect((await api.get('/stickers',b)).body.some((s:{id:string})=>s.id===sticker.id)).toBe(false);
    await api.post(`/messages/${b.id}`,{stickerId:sticker.id,mediaId:media.id},a).expect(400);
    await api.post(`/users/${b.id}/block`,{},a).expect(200);await api.post(`/messages/${a.id}`,{stickerId:sticker.id},b).expect(404);
  });
  it('normalizes playable audio, protects ownership, consumes drafts once and queues unsent audio erasure',async()=>{
    const clip=await uploadAudio();expect(clip.durationMs).toBeGreaterThanOrEqual(900);expect(clip.durationMs).toBeLessThan(1500);
    await api.post(`/messages/${a.id}`,{audioId:clip.id},b).expect(404);
    const sent=(await api.post(`/messages/${b.id}`,{audioId:clip.id},a).expect(201)).body;
    expect(sent).toMatchObject({audioDurationMs:clip.durationMs,media:null,sticker:null});
    expect(new URL(sent.audioUrl).pathname).toBe(new URL(clip.url).pathname);
    expect((await db.query('SELECT 1 FROM message_audio_uploads WHERE id=$1',[clip.id])).length).toBe(0);
    const key=(await db.query('SELECT audio_key FROM direct_messages WHERE id=$1',[sent.id]))[0].audio_key;
    expect((await db.query('SELECT 1 FROM media_file_deletions WHERE storage_key=$1',[key])).length).toBe(0);
    expect(await app.get(MediaService).resolveFile(key)).not.toBeNull();
    await db.query('INSERT INTO media_file_deletions(storage_key) VALUES($1)',[key]);
    await app.get(ContentDeletionService).retryFiles();
    expect(await app.get(MediaService).resolveFile(key)).not.toBeNull();
    await api.post(`/messages/${b.id}`,{audioId:clip.id},a).expect(404);
    const reply=(await api.post(`/messages/${a.id}`,{content:'heard it',replyToId:sent.id},b).expect(201)).body;
    expect(reply.replyTo.kind).toBe('AUDIO');
    await api.delete(`/messages/${sent.id}`,b).expect(404);await api.delete(`/messages/${sent.id}`,a).expect(204);
    expect(await app.get(MediaService).resolveFile(key)).toBeNull();
    expect((await db.query('SELECT 1 FROM media_file_deletions WHERE storage_key=$1',[key])).length).toBe(1);
    await app.get(ContentDeletionService).retryFiles();
  });
  it('rejects fake recordings and lets only the owner discard a draft',async()=>{
    await api.http.post('/api/messages/audio').set(a.auth).attach('file',Buffer.from('not audio'),{filename:'fake.webm',contentType:'audio/webm'}).expect(400);
    const clip=await uploadAudio();await api.delete(`/messages/audio/${clip.id}`,b).expect(404);await api.delete(`/messages/audio/${clip.id}`,a).expect(204);
    await api.post(`/messages/${b.id}`,{audioId:clip.id},a).expect(404);
  });
  it('permanently deletes voice drafts and sent recordings with an administrator account deletion',async()=>{
    const clip=await uploadAudio();
    await api.post(`/messages/${b.id}`,{audioId:clip.id},a).expect(201);
    const draft=await uploadAudio();
    const keys=(await db.query(`SELECT audio_key AS storage_key FROM direct_messages WHERE sender_id=$1
      UNION SELECT storage_key FROM message_audio_uploads WHERE owner_id=$1`,[a.id])).map((r:{storage_key:string})=>r.storage_key);
    expect(keys).toHaveLength(2);
    await api.setRole(c,'ADMIN');
    const token=(await api.post('/admin/step-up',{password:'password123'},c).expect(200)).body.token;
    const result=await api.post(`/admin/users/${a.id}/delete`,{confirmUsername:a.username,reason:'Voice account erasure QA'},c)
      .set('X-Step-Up-Token',token).expect(200);
    expect(result.body.files).toBe(2);
    expect(await db.query('SELECT id FROM message_audio_uploads WHERE id=$1',[draft.id])).toEqual([]);
    for(const key of keys)expect(await app.get(MediaService).resolveFile(key)).toBeNull();
  });
});
