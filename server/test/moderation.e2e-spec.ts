import { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Reports, moderation and notifications (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let alice: TestUser;
  let bob: TestUser;
  let mod: TestUser;
  let admin: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    alice = await api.register('alice');
    bob = await api.register('bob');
    mod = await api.register('mod');
    admin = await api.register('admin_u');
    await api.setRole(mod, 'MODERATOR');
    await api.setRole(admin, 'ADMIN');
  });
  afterAll(() => app.close());

  it('users can report content once while open; self-reports are rejected', async () => {
    const post = await api.createPost(alice, { content: 'spam spam' });
    const report = await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'SPAM', details: 'repeated' }, bob).expect(201);
    expect(report.body).toMatchObject({ targetType: 'POST', targetId: post.id, reason: 'SPAM', status: 'OPEN' });
    expect((await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'SPAM' }, bob).expect(409)).body.code).toBe('ALREADY_REPORTED');
    expect((await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'SPAM' }, alice).expect(400)).body.code).toBe('CANNOT_REPORT_SELF');
    await api.post('/reports', { targetType: 'USER', targetId: alice.id, reason: 'IMPERSONATION' }, bob).expect(201);
    await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'NOT_A_REASON' }, bob).expect(400);
  });

  it('ordinary users cannot access the moderation queue or actions', async () => {
    const post = await api.createPost(alice);
    expect((await api.get('/moderation/reports', bob).expect(403)).body.code).toBe('FORBIDDEN');
    await api.post(`/moderation/posts/${post.id}/remove`, undefined, bob).expect(403);
    await api.get('/moderation/reports').expect(401);
    // Moderators cannot perform admin-only actions.
    await api.post(`/moderation/users/${alice.id}/suspend`, undefined, mod).expect(403);
  });

  it('moderators resolve reports and remove content for everyone', async () => {
    const post = await api.createPost(alice, { content: 'bad' });
    const report = (await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'HATE_SPEECH' }, bob).expect(201)).body;

    const queue = await api.get('/moderation/reports', mod).expect(200);
    expect(queue.body.items[0]).toMatchObject({ id: report.id, reporter: { id: bob.id }, openReportsForTarget: 1 });

    const resolved = await api.patch(`/moderation/reports/${report.id}`, { status: 'RESOLVED', action: 'REMOVE_CONTENT', note: 'violates rules' }, mod).expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', resolvedById: mod.id, resolutionNote: 'violates rules' });
    await api.get(`/posts/${post.id}`, alice).expect(404);
    expect((await api.get('/feed/global')).body.items).toEqual([]);

    await api.post(`/moderation/posts/${post.id}/restore`, undefined, mod).expect(200);
    await api.get(`/posts/${post.id}`).expect(200);
  });

  it('admins can suspend accounts, which revokes sessions and hides content', async () => {
    const post = await api.createPost(alice);
    await api.post(`/moderation/users/${alice.id}/suspend`, undefined, admin).expect(200);
    await api.get('/users/me', alice).expect(401);
    const login = await api.post('/auth/login', { identifier: alice.username, password: 'password123' }).expect(403);
    expect(login.body.code).toBe('ACCOUNT_SUSPENDED');
    await api.get(`/posts/${post.id}`).expect(404);
    await api.get(`/users/${alice.username}`).expect(404);

    await api.post(`/moderation/users/${alice.id}/unsuspend`, undefined, admin).expect(200);
    await api.post('/auth/login', { identifier: alice.username, password: 'password123' }).expect(200);
  });

  it('notifications: unread count, mark read and mark all read', async () => {
    const post = await api.createPost(alice);
    await api.post(`/posts/${post.id}/like`, undefined, bob).expect(200);
    await api.post(`/users/${alice.id}/follow`, undefined, bob).expect(200);
    await api.post(`/posts/${post.id}/comments`, { content: 'hi' }, bob).expect(201);

    expect((await api.get('/notifications/unread-count', alice)).body.count).toBe(3);
    const list = await api.get('/notifications?limit=2', alice).expect(200);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.hasMore).toBe(true);
    expect(list.body.items[0]).toMatchObject({ type: 'COMMENT', actor: { id: bob.id }, postId: post.id, preview: 'hi', isRead: false });

    await api.post(`/notifications/${list.body.items[0].id}/read`, undefined, alice).expect(204);
    await api.post(`/notifications/${list.body.items[0].id}/read`, undefined, bob).expect(404); // not the recipient
    expect((await api.get('/notifications/unread-count', alice)).body.count).toBe(2);
    expect((await api.get('/notifications?unreadOnly=true', alice)).body.items).toHaveLength(2);

    expect((await api.post('/notifications/read-all', undefined, alice).expect(200)).body).toEqual({ updated: 2 });
    expect((await api.get('/notifications/unread-count', alice)).body.count).toBe(0);
  });
});
