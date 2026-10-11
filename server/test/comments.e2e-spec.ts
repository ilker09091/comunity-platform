import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Comments (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;
  let postId: string;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
    postId = (await api.createPost(alice, { content: 'discuss' })).id;
  });
  afterAll(() => app.close());

  const comment = (content: string, user: TestUser, parentId?: string) =>
    parentId
      ? api.post(`/comments/${parentId}/replies`, { content }, user).expect(201)
      : api.post(`/posts/${postId}/comments`, { content }, user).expect(201);

  it('supports nested replies with accurate counts and notifications', async () => {
    const top = (await comment('top', bob)).body;
    expect(top).toMatchObject({ depth: 0, parentId: null, status: 'ACTIVE', canReply: true, author: { id: bob.id } });
    const reply = (await comment('reply', alice, top.id)).body;
    expect(reply).toMatchObject({ depth: 1, parentId: top.id, postId });
    const nested = (await comment('nested', bob, reply.id)).body;
    expect(nested.depth).toBe(2);

    expect((await api.get(`/posts/${postId}`)).body.commentCount).toBe(3);
    const tops = await api.get(`/posts/${postId}/comments`).expect(200);
    expect(tops.body.items).toHaveLength(1);
    expect(tops.body.items[0]).toMatchObject({ id: top.id, replyCount: 1, hasReplies: true });

    const replies = await api.get(`/comments/${top.id}/replies`).expect(200);
    expect(replies.body.items.map((c: { id: string }) => c.id)).toEqual([reply.id]);

    const aliceTypes = (await api.get('/notifications', alice)).body.items.map((n: { type: string }) => n.type);
    expect(aliceTypes).toEqual(expect.arrayContaining(['COMMENT', 'COMMENT_REPLY']));
    const bobTypes = (await api.get('/notifications', bob)).body.items.map((n: { type: string }) => n.type);
    expect(bobTypes).toEqual(['COMMENT_REPLY']);
  });

  it('enforces the configured maximum depth', async () => {
    let parent = (await comment('d0', bob)).body;
    for (let d = 1; d < 6; d++) parent = (await comment(`d${d}`, bob, parent.id)).body;
    expect(parent).toMatchObject({ depth: 5, canReply: false });
    const res = await api.post(`/comments/${parent.id}/replies`, { content: 'too deep' }, bob).expect(422);
    expect(res.body.code).toBe('MAX_DEPTH_EXCEEDED');
  });

  it('deleted comments keep the thread intact as tombstones', async () => {
    const top = (await comment('top', bob)).body;
    const reply = (await comment('reply', alice, top.id)).body;
    const lonely = (await comment('lonely', bob)).body;

    await api.delete(`/comments/${top.id}`, bob).expect(204);
    await api.delete(`/comments/${lonely.id}`, bob).expect(204);

    const tops = await api.get(`/posts/${postId}/comments`).expect(200);
    expect(tops.body.items).toHaveLength(1);
    expect(tops.body.items[0]).toMatchObject({ id: top.id, status: 'DELETED', author: null, content: null, hasReplies: true });
    expect((await api.get(`/comments/${top.id}/replies`)).body.items[0].id).toBe(reply.id);
    expect((await api.get(`/posts/${postId}`)).body.commentCount).toBe(1);
    await api.post(`/comments/${top.id}/replies`, { content: 'x' }, alice).expect(404);
  });

  it('enforces ownership: only the author edits; author or post owner deletes', async () => {
    const c = (await comment('mine', bob)).body;
    await api.patch(`/comments/${c.id}`, { content: 'nope' }, alice).expect(403);
    const edited = await api.patch(`/comments/${c.id}`, { content: 'edited' }, bob).expect(200);
    expect(edited.body).toMatchObject({ content: 'edited', editedAt: expect.any(String) });

    const carol = await api.register('carol');
    await api.delete(`/comments/${c.id}`, carol).expect(403);
    await api.delete(`/comments/${c.id}`, alice).expect(204); // post owner moderates own thread
  });

  it('comment likes are idempotent', async () => {
    const c = (await comment('like me', bob)).body;
    await Promise.all([1, 2, 3, 4].map(() => api.post(`/comments/${c.id}/like`, undefined, alice).expect(200)));
    expect((await api.get(`/comments/${c.id}`, alice)).body).toMatchObject({ likeCount: 1, isLiked: true });
    const un = await api.delete(`/comments/${c.id}/like`, alice).expect(200);
    expect(un.body).toMatchObject({ liked: false, likeCount: 0 });
  });

  it('cross-post parent references are impossible at the database level', async () => {
    const other = await api.createPost(bob, { content: 'other' });
    const c = (await comment('on first post', bob)).body;
    const db = app.get(DataSource);
    await expect(
      db.query(
        `INSERT INTO comments (post_id, author_id, parent_id, depth, content) VALUES ($1, $2, $3, 1, 'x')`,
        [other.id, bob.id, c.id],
      ),
    ).rejects.toThrow(/fk_comments_parent/);
  });

  it('paginates comments with sort options', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await comment(`c${i}`, bob)).body.id);
    await api.post(`/comments/${ids[2]}/like`, undefined, alice).expect(200);

    const page1 = await api.get(`/posts/${postId}/comments?limit=2&sort=OLDEST`).expect(200);
    const page2 = await api.get(`/posts/${postId}/comments?limit=2&sort=OLDEST&cursor=${page1.body.nextCursor}`).expect(200);
    expect([...page1.body.items, ...page2.body.items].map((c: { id: string }) => c.id)).toEqual(ids.slice(0, 4));

    const top = await api.get(`/posts/${postId}/comments?sort=TOP&limit=1`).expect(200);
    expect(top.body.items[0].id).toBe(ids[2]);
    await api.get(`/posts/${postId}/comments?sort=TOP&cursor=${top.body.nextCursor}`).expect(200);
  });
});
