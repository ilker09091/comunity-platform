import { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Profiles, follows and blocks (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
  });
  afterAll(() => app.close());

  const profile = (username: string, viewer?: TestUser) => api.get(`/users/${username}`, viewer);

  it('serves public profiles case-insensitively without private data', async () => {
    const res = await profile(alice.username.toUpperCase()).expect(200);
    expect(res.body).toMatchObject({ id: alice.id, username: alice.username, isSelf: false, canViewContent: true });
    expect(res.body.email).toBeUndefined();
    await profile('does_not_exist').expect(404);
  });

  it('updates own profile and enforces unique usernames', async () => {
    const res = await api.patch('/users/me', { displayName: '  Alice A.  ', bio: 'Hi!\u0000', website: 'https://alice.dev' }, alice).expect(200);
    expect(res.body).toMatchObject({ displayName: 'Alice A.', bio: 'Hi!', website: 'https://alice.dev' });
    const taken = await api.patch('/users/me', { username: bob.username.toUpperCase() }, alice).expect(409);
    expect(taken.body.code).toBe('USERNAME_TAKEN');
    await api.patch('/users/me', { website: 'javascript:alert(1)' }, alice).expect(400);
  });

  it('follow/unfollow is idempotent and keeps counters consistent', async () => {
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    const again = await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    expect(again.body).toEqual({ status: 'FOLLOWING', followerCount: 1 });

    const bobProfile = await profile(bob.username, alice).expect(200);
    expect(bobProfile.body).toMatchObject({ followerCount: 1, isFollowing: true });
    expect((await api.get('/users/me', alice)).body.followingCount).toBe(1);

    const followers = await api.get(`/users/${bob.id}/followers`, alice).expect(200);
    expect(followers.body.items.map((u: { id: string }) => u.id)).toEqual([alice.id]);

    await api.delete(`/users/${bob.id}/follow`, alice).expect(200);
    const after = await api.delete(`/users/${bob.id}/follow`, alice).expect(200);
    expect(after.body).toEqual({ status: 'NONE', followerCount: 0 });
    expect((await api.get('/users/me', alice)).body.followingCount).toBe(0);
  });

  it('prevents self-follow and survives concurrent duplicate follows', async () => {
    const self = await api.post(`/users/${alice.id}/follow`, undefined, alice).expect(400);
    expect(self.body.code).toBe('CANNOT_FOLLOW_SELF');

    await Promise.all(Array.from({ length: 8 }, () => api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200)));
    expect((await profile(bob.username)).body.followerCount).toBe(1);
    expect((await api.get('/notifications', bob)).body.items.filter((n: { type: string }) => n.type === 'NEW_FOLLOWER')).toHaveLength(1);
  });

  it('private accounts require approval', async () => {
    await api.patch('/users/me', { isPrivate: true }, bob).expect(200);
    await api.createPost(bob, { content: 'secret' });

    const req = await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    expect(req.body.status).toBe('REQUESTED');
    const hidden = await api.get(`/users/${bob.id}/posts`, alice).expect(403);
    expect(hidden.body.code).toBe('PRIVATE_ACCOUNT');
    expect((await profile(bob.username, alice)).body).toMatchObject({ isFollowRequested: true, canViewContent: false });

    const requests = await api.get('/users/me/follow-requests', bob).expect(200);
    expect(requests.body.items[0].user.id).toBe(alice.id);
    await api.post(`/users/me/follow-requests/${alice.id}/accept`, undefined, bob).expect(204);

    const posts = await api.get(`/users/${bob.id}/posts`, alice).expect(200);
    expect(posts.body.items).toHaveLength(1);
    const types = (await api.get('/notifications', alice)).body.items.map((n: { type: string }) => n.type);
    expect(types).toContain('FOLLOW_ACCEPTED');
  });

  it('follow request notifications expose an actionable status', async () => {
    await api.patch('/users/me', { isPrivate: true }, bob).expect(200);
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    const requestNote = async () =>
      (await api.get('/notifications', bob).expect(200)).body.items.find((n: { type: string }) => n.type === 'FOLLOW_REQUEST');

    let note = await requestNote();
    expect(note).toMatchObject({ actor: { id: alice.id }, followRequestStatus: 'PENDING' });
    // The request is identified by the requester id carried in actor.id.
    await api.post(`/users/me/follow-requests/${note.actor.id}/accept`, undefined, bob).expect(204);
    note = await requestNote();
    expect(note.followRequestStatus).toBe('ACCEPTED');
    // Accepting again (e.g. from another screen) is reported as not found, not silently re-applied.
    expect((await api.post(`/users/me/follow-requests/${alice.id}/accept`, undefined, bob).expect(404)).body.code).toBe('NOT_FOUND');
    expect((await api.get('/users/me', bob)).body.followerCount).toBe(1);

    // Removing the follower makes the old request no longer actionable.
    await api.delete(`/users/me/followers/${alice.id}`, bob).expect(204);
    expect((await requestNote()).followRequestStatus).toBe('UNAVAILABLE');

    // A fresh request is PENDING again (single notification, unread).
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    const notes = (await api.get('/notifications', bob)).body.items.filter((n: { type: string }) => n.type === 'FOLLOW_REQUEST');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ followRequestStatus: 'PENDING', isRead: false });

    // Cancelled by the sender: the notification disappears; declining likewise.
    await api.delete(`/users/${bob.id}/follow`, alice).expect(200);
    expect(await requestNote()).toBeUndefined();
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    await api.delete(`/users/me/follow-requests/${alice.id}`, bob).expect(204);
    expect(await requestNote()).toBeUndefined();

    const other = (await api.get('/notifications', alice)).body.items;
    expect(other.every((n: { followRequestStatus: unknown }) => n.followRequestStatus === null)).toBe(true);
  });

  it('suggests followable accounts ranked by mutual connections', async () => {
    const carol = await api.register('carol');
    const dave = await api.register('dave');
    const eve = await api.register('eve');
    // alice follows bob; bob follows carol -> carol has 1 mutual for alice.
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    await api.post(`/users/${carol.id}/follow`, undefined, bob).expect(200);
    await api.post(`/users/${eve.id}/block`, undefined, alice).expect(200);
    await api.patch('/users/me', { isPrivate: true }, dave).expect(200);
    await api.post(`/users/${dave.id}/follow`, undefined, alice).expect(200); // pending request

    const res = await api.get('/users/me/suggestions?limit=10', alice).expect(200);
    const ids = res.body.items.map((u: { id: string }) => u.id);
    expect(ids[0]).toBe(carol.id);
    expect(res.body.items[0]).toMatchObject({ mutualFollowerCount: 1, isFollowing: false });
    expect(ids).not.toContain(alice.id); // self
    expect(ids).not.toContain(bob.id); // already followed
    expect(ids).not.toContain(dave.id); // already requested
    expect(ids).not.toContain(eve.id); // blocked
    await api.get('/users/me/suggestions').expect(401);
    await api.get('/users/me/suggestions?limit=99', alice).expect(400);
  });

  it('switching to public auto-approves pending requests', async () => {
    await api.patch('/users/me', { isPrivate: true }, bob).expect(200);
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    await api.patch('/users/me', { isPrivate: false }, bob).expect(200);
    expect((await profile(bob.username, alice)).body).toMatchObject({ isFollowing: true, followerCount: 1 });
  });

  it('blocking severs follows, hides content and prevents interaction', async () => {
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(200);
    await api.post(`/users/${alice.id}/follow`, undefined, bob).expect(200);
    const post = await api.createPost(bob, { content: 'bob post' });

    await api.post(`/users/${alice.id}/block`, undefined, bob).expect(200);
    expect((await api.get('/users/me', bob)).body).toMatchObject({ followerCount: 0, followingCount: 0 });

    // Blocked user can't see the blocker at all.
    await profile(bob.username, alice).expect(404);
    await api.get(`/posts/${post.id}`, alice).expect(404);
    await api.post(`/posts/${post.id}/like`, undefined, alice).expect(404);
    await api.post(`/users/${bob.id}/follow`, undefined, alice).expect(404);
    // Blocker can't follow either until unblocking.
    const blocked = await api.post(`/users/${alice.id}/follow`, undefined, bob).expect(403);
    expect(blocked.body.code).toBe('BLOCKED');
    expect((await api.get('/users/me/blocks', bob)).body.items[0].user.id).toBe(alice.id);

    await api.delete(`/users/${alice.id}/block`, bob).expect(200);
    await api.get(`/posts/${post.id}`, alice).expect(200);
  });

  it('rejects invalid UUID path params with the standard error body', async () => {
    const res = await api.post('/users/not-a-uuid/follow', undefined, alice).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});
