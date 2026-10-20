import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { STORAGE_DRIVER, type StorageDriver } from '../src/modules/media/storage/storage.driver.js';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';

describe('Messaging upgrade: groups, edits, note replies and Circle invites', () => {
  let app: INestApplication, api: Api, db: DataSource;
  let a: TestUser, b: TestUser, c: TestUser, stranger: TestUser;
  beforeAll(async () => { app=await createTestApp(); api=new Api(app); db=app.get(DataSource); });
  beforeEach(async () => {
    await resetDatabase(app);
    [a,b,c,stranger]=[await api.register('ana'),await api.register('ben'),await api.register('cem'),await api.register('stranger')];
    for(const peer of [b,c]) {
      await api.post(`/users/${peer.id}/follow`,{},a).expect(200);
      await api.post(`/users/${a.id}/follow`,{},peer).expect(200);
    }
  });
  afterAll(()=>app?.close());
  const create=async()=> (await api.post('/group-chats',{name:'Weekend friends',memberIds:[b.id,c.id]},a).expect(201)).body;
  const history=async(id:string,user=a)=> (await api.get(`/group-chats/${id}/messages`,user).expect(200)).body.items;
  const image=async(user:TestUser)=> {
    const png=await sharp({create:{width:32,height:32,channels:3,background:'#7845ff'}}).png().toBuffer();
    return (await api.http.post('/api/media').set(user.auth).attach('file',png,{filename:'p.png',contentType:'image/png'}).expect(201)).body;
  };

  it('uses note ids, replies into DMs with a snapshot, and respects expired/blocked notes', async()=> {
    const note=(await api.post('/notes',{text:'Reply to this note'},a).expect(201)).body;
    expect(note.id).not.toBe(a.id);
    expect((await api.get('/notes',b).expect(200)).body.find((n:any)=>n.id===note.id)).toBeTruthy();
    const reply=(await api.post(`/notes/${note.id}/reply`,{content:'Sounds good!'},b).expect(201)).body;
    expect(reply).toMatchObject({content:'Sounds good!',senderId:b.id,noteReply:{text:'Reply to this note'}});
    await api.post(`/notes/${note.id}/reply`,{content:'self'},a).expect(400);
    await api.post(`/notes/${note.id}/reply`,{content:'stranger'},stranger).expect(404);
    await api.post(`/users/${b.id}/block`,{},a).expect(200);
    await api.post(`/notes/${note.id}/reply`,{content:'blocked'},b).expect(404);
    await db.query("UPDATE notes SET expires_at=now()-interval '1 second'");
    await api.post(`/notes/${note.id}/reply`,{content:'expired'},c).expect(404);
  });

  it('only edits the sender’s text and exposes the edit consistently to both people', async()=> {
    const message=(await api.post(`/messages/${b.id}`,{content:'Before https://example.com'},a).expect(201)).body;
    expect(message.editedAt).toBeNull();
    await api.patch(`/messages/${message.id}`,{content:'Not yours'},b).expect(404);
    await api.patch(`/messages/${message.id}`,{content:'   '},a).expect(400);
    const edited=(await api.patch(`/messages/${message.id}`,{content:'After https://example.com/help'},a).expect(200)).body;
    expect(edited.content).toBe('After https://example.com/help'); expect(edited.editedAt).toBeTruthy();
    expect((await api.get(`/messages/${a.id}`,b).expect(200)).body.items[0]).toMatchObject({id:message.id,content:edited.content,editedAt:edited.editedAt});
    await api.post(`/users/${a.id}/block`,{},b).expect(200);
    await api.patch(`/messages/${message.id}`,{content:'Blocked edit'},a).expect(404);
  });

  it('validates contacts and enforces membership and owner permissions', async()=> {
    await api.post('/group-chats',{name:'Too small',memberIds:[b.id]},a).expect(400);
    await api.post('/group-chats',{name:'Stranger',memberIds:[b.id,stranger.id]},a).expect(403);
    const group=await create(); expect(group.memberCount).toBe(3); expect(group.members.map((m:any)=>m.id)).toEqual(expect.arrayContaining([a.id,b.id,c.id]));
    expect((await api.get('/group-chats',b).expect(200)).body.items[0].id).toBe(group.id);
    await api.get(`/group-chats/${group.id}`,stranger).expect(404);
    await api.get(`/group-chats/${group.id}/messages`,stranger).expect(404);
    await api.post(`/group-chats/${group.id}/messages`,{content:'intruder'},stranger).expect(404);
    await api.patch(`/group-chats/${group.id}`,{name:'Hijack'},b).expect(403);
    await api.delete(`/group-chats/${group.id}/members/${a.id}`,b).expect(403);
    await api.patch(`/group-chats/${group.id}`,{name:'Renamed friends'},a).expect(200);
    await api.delete(`/group-chats/${group.id}/members/${c.id}`,a).expect(204);
    await api.get(`/group-chats/${group.id}`,c).expect(404);
    await api.post(`/group-chats/${group.id}/members`,{memberIds:[c.id]},a).expect(201);
    expect((await api.get(`/group-chats/${group.id}`,c).expect(200)).body.name).toBe('Renamed friends');
  });

  it('tracks all-member delivery/read receipts, unread counts and monotonic acknowledgements', async()=> {
    const g=await create();
    const sent=(await api.post(`/group-chats/${g.id}/messages`,{content:'Hello group'},a).expect(201)).body;
    expect(sent).toMatchObject({senderId:a.id,sender:{id:a.id},content:'Hello group',readAt:null,deliveredAt:null});
    expect((await api.get('/messages/unread-count',b).expect(200)).body.count).toBe(1);
    const outsider=(await api.get('/messages/delivery',stranger).expect(200)).body;
    expect(outsider.groupMessageIds).toEqual([]);
    await api.post('/messages/delivery',{messageIds:[],groupMessageIds:[sent.id]},stranger).expect(204);
    expect((await history(g.id))[0].deliveredAt).toBeNull();
    for(const user of [b,c]) {
      const pending=(await api.get('/messages/delivery',user).expect(200)).body;
      expect(pending.groupMessageIds).toEqual([sent.id]);
      await api.post('/messages/delivery',pending,user).expect(204);
    }
    expect((await history(g.id))[0].deliveredAt).toBeTruthy(); expect((await history(g.id))[0].readAt).toBeNull();
    await api.post(`/group-chats/${g.id}/receipts`,{messageId:sent.id,read:true},b).expect(204);
    expect((await api.get('/messages/unread-count',b).expect(200)).body.count).toBe(0);
    expect((await history(g.id))[0].readAt).toBeNull();
    await api.post(`/group-chats/${g.id}/receipts`,{messageId:sent.id,read:true},c).expect(204);
    await api.post(`/group-chats/${g.id}/receipts`,{messageId:sent.id,read:false},c).expect(204);
    expect((await history(g.id))[0].readAt).toBeTruthy();
    await api.post(`/group-chats/${g.id}/receipts`,{messageId:sent.id,read:true},stranger).expect(404);
  });

  it('paginates without duplicates and supports replies, edits and unsending in a group', async()=> {
    const g=await create(); const ids:string[]=[];
    for(let i=0;i<5;i++)ids.push((await api.post(`/group-chats/${g.id}/messages`,{content:`Message ${i}`},a).expect(201)).body.id);
    const page=(await api.get(`/group-chats/${g.id}/messages?limit=2`,b).expect(200)).body;
    const next=(await api.get(`/group-chats/${g.id}/messages?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`,b).expect(200)).body;
    expect(page.hasMore).toBe(true);expect(new Set([...page.items,...next.items].map((m:any)=>m.id)).size).toBe(4);
    const reply=(await api.post(`/group-chats/${g.id}/messages`,{content:'Reply',replyToId:ids[0]},b).expect(201)).body;
    expect(reply.replyTo).toMatchObject({id:ids[0],senderId:a.id,kind:'TEXT',preview:'Message 0'});
    await api.patch(`/group-chats/${g.id}/messages/${reply.id}`,{content:'Forged'},a).expect(404);
    const edit=(await api.patch(`/group-chats/${g.id}/messages/${reply.id}`,{content:'Edited reply'},b).expect(200)).body;
    expect(edit.editedAt).toBeTruthy();expect(edit.content).toBe('Edited reply');
    await api.delete(`/group-chats/${g.id}/messages/${ids[0]}`,b).expect(404);
    await api.delete(`/group-chats/${g.id}/messages/${ids[0]}`,a).expect(204);
    expect((await history(g.id,b)).find((m:any)=>m.id===reply.id).replyTo).toBeNull();
  });

  it('hides blocked group members, their messages, previews and quotes', async()=> {
    const g=await create();
    const hidden=(await api.post(`/group-chats/${g.id}/messages`,{content:'Hidden secret'},a).expect(201)).body;
    const reply=(await api.post(`/group-chats/${g.id}/messages`,{content:'Visible reply',replyToId:hidden.id},c).expect(201)).body;
    await api.post(`/users/${b.id}/block`,{},a).expect(200);
    const visible=await history(g.id,b);expect(visible.map((m:any)=>m.id)).not.toContain(hidden.id);
    expect(visible.find((m:any)=>m.id===reply.id).replyTo.preview).toBe('Message unavailable');
    const masked=(await api.get(`/group-chats/${g.id}`,b).expect(200)).body.members.find((m:any)=>m.id===a.id);
    expect(masked).toMatchObject({username:'',displayName:'Circle user',avatarUrl:null});
    await api.post(`/group-chats/${g.id}/messages`,{content:'Newest hidden'},a).expect(201);
    expect((await api.get('/group-chats',b).expect(200)).body.items[0].lastMessage).toBe('Visible reply');
    await api.post('/group-chats',{name:'Blocked',memberIds:[b.id,c.id]},a).expect(404);
  });

  it('checks attachment ownership, keeps group media alive, and lets recipients favorite custom stickers', async()=> {
    const g=await create(), media=await image(a);
    await api.post(`/group-chats/${g.id}/messages`,{mediaId:media.id},b).expect(404);
    const sent=(await api.post(`/group-chats/${g.id}/messages`,{mediaId:media.id},a).expect(201)).body;
    expect(sent.media.id).toBe(media.id);
    const quote=(await api.post(`/group-chats/${g.id}/messages`,{content:'Nice photo',replyToId:sent.id},c).expect(201)).body.replyTo;
    expect(quote.kind).toBe('PHOTO');expect(quote.thumbnailUrl).toBeTruthy();
    await api.delete(`/media/${media.id}`,a).expect(409);
    const stickerMedia=await image(a);
    const sticker=(await api.post('/stickers',{mediaId:stickerMedia.id,name:'Group star'},a).expect(201)).body;
    await api.post(`/group-chats/${g.id}/messages`,{stickerId:sticker.id},a).expect(201);
    await api.post(`/stickers/${sticker.id}/favorite`,{},b).expect(204);
    await api.delete(`/stickers/${sticker.id}`,a).expect(204);
    expect((await history(g.id,b)).find((m:any)=>m.sticker?.id===sticker.id).sticker.url).toBeTruthy();
    await api.post(`/group-chats/${g.id}/messages`,{stickerId:sticker.id},b).expect(201);
    await api.post(`/group-chats/${g.id}/messages`,{mediaId:media.id,stickerId:sticker.id},a).expect(400);
    await api.delete(`/group-chats/${g.id}/messages/${sent.id}`,a).expect(204);
    expect((await db.query('SELECT 1 FROM media WHERE id=$1',[media.id])).length).toBe(0);
  });

  it('shares a Circle invitation through both chat types and preserves join access rules', async()=> {
    const g=await create();
    const circle=(await api.post('/circles',{name:'Close circle',emoji:'🌸',color:'#7c5cff'},a).expect(201)).body;
    const content=`Join Close circle\nhttps://circle.example/circles/join/${circle.inviteCode}`;
    await api.post(`/messages/${b.id}`,{content},a).expect(201);
    await api.post(`/group-chats/${g.id}/messages`,{content},a).expect(201);
    expect((await history(g.id,c))[0].content).toBe(content);
    await api.get(`/circles/invites/${circle.inviteCode}`,c).expect(200);
    expect((await api.post('/circles/join',{code:circle.inviteCode},c).expect(200)).body.id).toBe(circle.id);
  });

  it('transfers ownership when the owner leaves and deletes an empty group', async()=> {
    const g=await create();
    await api.delete(`/group-chats/${g.id}/membership`,a).expect(204);
    await api.get(`/group-chats/${g.id}`,a).expect(404);
    const owner=(await api.get(`/group-chats/${g.id}`,b).expect(200)).body.ownerId;
    expect([b.id,c.id]).toContain(owner);
    await api.delete(`/group-chats/${g.id}/membership`,b).expect(204);
    await api.delete(`/group-chats/${g.id}/membership`,c).expect(204);
    expect((await db.query('SELECT 1 FROM chat_groups WHERE id=$1',[g.id])).length).toBe(0);
  });

  it('cleans up voice files from a group when its owner account is permanently deleted',async()=>{
    const g=await create(),storage=app.get<StorageDriver>(STORAGE_DRIVER);
    const audioKey='f0'.repeat(16)+'.m4a';
    await storage.put(audioKey,Buffer.from('audio-cleanup-fixture'),'audio/mp4');
    await db.query('INSERT INTO group_messages(group_id,sender_id,audio_key,audio_duration_ms) VALUES($1,$2,$3,1000)',[g.id,b.id,audioKey]);
    await api.setRole(stranger,'ADMIN');
    const token=(await api.post('/admin/step-up',{password:'password123'},stranger).expect(200)).body.token;
    await api.post(`/admin/users/${a.id}/delete`,{reason:'Requested account removal',confirmUsername:a.username},stranger).set('X-Step-Up-Token',token).expect(200);
    expect(await db.query('SELECT id FROM chat_groups WHERE id=$1',[g.id])).toEqual([]);
    expect(await storage.resolve(audioKey)).toBeNull();
    expect(await db.query('SELECT id FROM users WHERE id=$1',[b.id])).toHaveLength(1);
  });
});
