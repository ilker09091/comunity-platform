import { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Posts, likes, bookmarks and reposts (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
    carol = await api.register('carol');
  });
  afterAll(() => app.close());

  describe('posts', () => {
    it('creates, edits and permanently deletes own posts with consistent counters', async () => {
      const post = await api.createPost(alice, { content: 'first', authorId: bob.id }).catch(() => null);
      expect(post).toBeNull(); // client-supplied author ids are rejected (whitelist)

      const created = await api.createPost(alice, { content: '  hello\r\nworld  ' });
      expect(created).toMatchObject({ kind: 'POST', content: 'hello\nworld', author: { id: alice.id }, editedAt: null, likeCount: 0 });
      expect((await api.get('/users/me', alice)).body.postCount).toBe(1);

      const edited = await api.patch(`/posts/${created.id}`, { content: 'edited' }, alice).expect(200);
      expect(edited.body.content).toBe('edited');
      expect(edited.body.editedAt).not.toBeNull();

      await api.delete(`/posts/${created.id}`, alice).expect(204);
      await api.get(`/posts/${created.id}`).expect(404);
      await api.delete(`/posts/${created.id}`, alice).expect(404);
      expect((await api.get('/users/me', alice)).body.postCount).toBe(0);
    });

    it('forbids modifying other users posts', async () => {
      const post = await api.createPost(alice);
      expect((await api.patch(`/posts/${post.id}`, { content: 'hacked' }, bob).expect(403)).body.code).toBe('FORBIDDEN');
      await api.delete(`/posts/${post.id}`, bob).expect(403);
      await api.patch(`/posts/${post.id}`, { content: 'anon' }).expect(401);
    });

    it('validates content', async () => {
      const empty = await api.post('/posts', { content: '   ' }, alice).expect(400);
      expect(empty.body.code).toBe('VALIDATION_ERROR');
      await api.post('/posts', { content: 'x'.repeat(5001) }, alice).expect(400);
      await api.post('/posts', { content: 'ok', visibility: 'SECRET' }, alice).expect(400);
      await api.post('/posts', { mediaIds: ['not-a-uuid'] }, alice).expect(400);
      const missing = await api.post('/posts', { mediaIds: ['3fa85f64-5717-4562-b3fc-2c963f66afa6'] }, alice).expect(404);
      expect(missing.body.code).toBe('MEDIA_NOT_FOUND');
    });

    it('enforces FOLLOWERS visibility', async () => {
      const post = await api.createPost(alice, { content: 'friends only', visibility: 'FOLLOWERS' });
      await api.get(`/posts/${post.id}`).expect(404);
      await api.get(`/posts/${post.id}`, bob).expect(404);
      await api.post(`/users/${alice.id}/follow`, undefined, bob).expect(200);
      await api.get(`/posts/${post.id}`, bob).expect(200);
      const global = await api.get('/feed/global').expect(200);
      expect(global.body.items.map((p: { id: string }) => p.id)).not.toContain(post.id);
    });
  });

  describe('likes', () => {
    it('is idempotent and concurrency-safe, with isLiked per viewer', async () => {
      const post = await api.createPost(alice);
      await Promise.all(Array.from({ length: 10 }, () => api.post(`/posts/${post.id}/like`, undefined, bob).expect(200)));
      const res = await api.post(`/posts/${post.id}/like`, undefined, bob).expect(200);
      expect(res.body).toEqual({ id: post.id, liked: true, likeCount: 1 });

      expect((await api.get(`/posts/${post.id}`, bob)).body.isLiked).toBe(true);
      expect((await api.get(`/posts/${post.id}`, carol)).body.isLiked).toBe(false);
      expect((await api.get(`/posts/${post.id}`)).body).toMatchObject({ isLiked: false, likeCount: 1 });

      // Like → unlike → like does not create duplicate notifications.
      await api.delete(`/posts/${post.id}/like`, bob).expect(200);
      const un = await api.delete(`/posts/${post.id}/like`, bob).expect(200);
      expect(un.body).toMatchObject({ liked: false, likeCount: 0 });
      await api.post(`/posts/${post.id}/like`, undefined, bob).expect(200);
      const notes = (await api.get('/notifications', alice)).body.items.filter((n: { type: string }) => n.type === 'POST_LIKE');
      expect(notes).toHaveLength(1);
      expect(notes[0].actor.id).toBe(bob.id);

      const likers = await api.get(`/posts/${post.id}/likes`).expect(200);
      expect(likers.body.items.map((u: { id: string }) => u.id)).toEqual([bob.id]);
    });

    it('does not notify users about their own actions', async () => {
      const post = await api.createPost(alice);
      await api.post(`/posts/${post.id}/like`, undefined, alice).expect(200);
      expect((await api.get('/notifications/unread-count', alice)).body).toEqual({ count: 0 });
    });
  });

  describe('bookmarks', () => {
    it('are private to their owner', async () => {
      const post = await api.createPost(alice);
      await api.post(`/posts/${post.id}/bookmark`, undefined, bob).expect(200);
      const again = await api.post(`/posts/${post.id}/bookmark`, undefined, bob).expect(200);
      expect(again.body).toEqual({ postId: post.id, bookmarked: true, bookmarkCount: 1 });

      const bobs = await api.get('/users/me/bookmarks', bob).expect(200);
      expect(bobs.body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
      expect(bobs.body.items[0].isBookmarked).toBe(true);

      expect((await api.get('/users/me/bookmarks', carol).expect(200)).body.items).toEqual([]);
      expect((await api.get(`/posts/${post.id}`, carol)).body.isBookmarked).toBe(false);
      await api.get('/users/me/bookmarks').expect(401);

      await api.delete(`/posts/${post.id}/bookmark`, bob).expect(200);
      expect((await api.get('/users/me/bookmarks', bob)).body.items).toEqual([]);
    });
  });

  describe('reposts', () => {
    it('simple repost is idempotent, attributed, and never chains', async () => {
      const original = await api.createPost(alice, { content: 'original' });
      const first = await api.post(`/posts/${original.id}/repost`, undefined, bob).expect(200);
      await Promise.all([1, 2, 3].map(() => api.post(`/posts/${original.id}/repost`, undefined, bob).expect(200)));
      expect(first.body).toMatchObject({ postId: original.id, reposted: true, repostCount: 1 });

      // Reposting the repost targets the original.
      const viaRepost = await api.post(`/posts/${first.body.repostId}/repost`, undefined, carol).expect(200);
      expect(viaRepost.body).toMatchObject({ postId: original.id, repostCount: 2 });

      const repostItem = (await api.get(`/posts/${first.body.repostId}`, bob)).body;
      expect(repostItem).toMatchObject({
        kind: 'REPOST',
        author: { id: bob.id },
        referencedPost: { id: original.id, author: { id: alice.id }, isReposted: true },
        referencedPostUnavailable: false,
      });

      const undo = await api.delete(`/posts/${original.id}/repost`, bob).expect(200);
      expect(undo.body).toMatchObject({ reposted: false, repostCount: 1, repostId: null });
      expect((await api.get(`/posts/${original.id}`, bob)).body.isReposted).toBe(false);
    });

    it('counts quotes as posts but not plain reposts', async () => {
      const original = await api.createPost(alice, { content: 'original' });
      await api.post(`/posts/${original.id}/repost`, undefined, bob).expect(200);
      expect((await api.get('/users/me', bob)).body.postCount).toBe(0);
      expect((await api.get(`/users/${bob.username}`)).body.postCount).toBe(0);
      await api.post(`/posts/${original.id}/quote`, { content: 'my take' }, bob).expect(201);
      expect((await api.get('/users/me', bob)).body.postCount).toBe(1);
      expect((await api.get('/users/me', alice)).body.postCount).toBe(1);
    });

    it('quote reposts embed the original and handle deleted originals', async () => {
      const original = await api.createPost(alice, { content: 'original' });
      const quote = await api.post(`/posts/${original.id}/quote`, { content: 'my take' }, bob).expect(201);
      expect(quote.body).toMatchObject({ kind: 'QUOTE', content: 'my take', referencedPost: { id: original.id } });
      expect((await api.get(`/posts/${original.id}`)).body.quoteCount).toBe(1);
      const quoteNotes = (await api.get('/notifications', alice)).body.items.map((n: { type: string }) => n.type);
      expect(quoteNotes).toContain('QUOTE_REPOST');

      await api.post(`/posts/${original.id}/repost`, undefined, carol).expect(200);
      await api.delete(`/posts/${original.id}`, alice).expect(204);

      const orphanQuote = (await api.get(`/posts/${quote.body.id}`)).body;
      expect(orphanQuote).toMatchObject({ referencedPost: null, referencedPostUnavailable: true });
      // Simple reposts of unavailable originals disappear from timelines.
      const carolPosts = await api.get(`/users/${carol.id}/posts`).expect(200);
      expect(carolPosts.body.items).toEqual([]);
    });

    it('respects visibility: followers-only and private posts cannot be reposted', async () => {
      const hidden = await api.createPost(alice, { content: 'friends', visibility: 'FOLLOWERS' });
      await api.post(`/users/${alice.id}/follow`, undefined, bob).expect(200);
      const res = await api.post(`/posts/${hidden.id}/repost`, undefined, bob).expect(422);
      expect(res.body.code).toBe('POST_NOT_REPOSTABLE');
      await api.post(`/posts/${hidden.id}/quote`, { content: 'x' }, carol).expect(404);
    });
  });

  describe('feeds and cursor pagination', () => {
    it('pages the global feed deterministically without duplicates or gaps', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 23; i++) ids.push((await api.createPost(i % 2 ? alice : bob, { content: `post ${i}` })).id);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: { body: { items: { id: string }[]; nextCursor: string | null; hasMore: boolean } } = await api
          .get(`/feed/global?limit=10${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        seen.push(...res.body.items.map((p: { id: string }) => p.id));
        expect(res.body.hasMore).toBe(res.body.nextCursor !== null);
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toEqual([...ids].reverse());
      expect((await api.get('/feed/global?cursor=garbage').expect(400)).body.code).toBe('INVALID_CURSOR');
      await api.get('/feed/global?limit=51').expect(400);
    });

    it('following feed shows own and followed posts including reposts', async () => {
      const own = await api.createPost(alice, { content: 'mine' });
      const bobPost = await api.createPost(bob, { content: 'bob' });
      const carolPost = await api.createPost(carol, { content: 'carol' });
      await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
      await api.post(`/posts/${carolPost.id}/repost`, undefined, bob).expect(200);

      const feed = await api.get('/feed/following', alice).expect(200);
      const items = feed.body.items as { id: string; kind: string; referencedPost: { id: string } | null; isFollowingAuthor: boolean }[];
      expect(items.map((p) => p.kind)).toEqual(['REPOST', 'POST', 'POST']);
      expect(items[0].referencedPost!.id).toBe(carolPost.id);
      expect(items.map((p) => p.id)).toEqual(expect.arrayContaining([own.id, bobPost.id]));
      expect(items.find((p) => p.id === bobPost.id)!.isFollowingAuthor).toBe(true);
      expect(items.map((p) => p.id)).not.toContain(carolPost.id);
    });

    it('explore ranks engaged posts first and returns the same item shape', async () => {
      const quiet = await api.createPost(alice, { content: 'quiet' });
      const popular = await api.createPost(bob, { content: 'popular' });
      await api.post(`/posts/${popular.id}/like`, undefined, alice).expect(200);
      await api.post(`/posts/${popular.id}/like`, undefined, carol).expect(200);
      await api.post(`/posts/${popular.id}/comments`, { content: 'nice' }, carol).expect(201);

      const res = await api.get('/feed/explore?limit=1', carol).expect(200);
      expect(res.body.items[0]).toMatchObject({ id: popular.id, isLiked: true, commentCount: 1 });
      const next = await api.get(`/feed/explore?limit=1&cursor=${res.body.nextCursor}`).expect(200);
      expect(next.body.items[0].id).toBe(quiet.id);
      expect(next.body.hasMore).toBe(false);
    });
  });

  describe('search', () => {
    it('finds users and posts', async () => {
      await api.patch('/users/me', { displayName: 'Zebra Specialist' }, alice).expect(200);
      await api.createPost(bob, { content: 'Zebras are striped horses' });
      await api.createPost(bob, { content: 'unrelated' });

      const users = await api.get('/search/users?q=zebra').expect(200);
      expect(users.body.items[0].id).toBe(alice.id);
      const byName = await api.get(`/search/users?q=@${alice.username.slice(0, 6)}`).expect(200);
      expect(byName.body.items.map((u: { id: string }) => u.id)).toContain(alice.id);

      const posts = await api.get(`/search/posts?q=${encodeURIComponent('zebras')}`).expect(200);
      expect(posts.body.items).toHaveLength(1);
      await api.get('/search/posts?q=').expect(400);
      // Special characters are treated as data, not syntax.
      await api.get(`/search/posts?q=${encodeURIComponent("'); DROP TABLE posts; --")}`).expect(200);
      await api.get(`/search/users?q=${encodeURIComponent('%_\\')}`).expect(200);
    });
  });
});
