import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Admin control center (e2e)', () => {
  let app: INestApplication;
  let api: Api;
  let db: DataSource;
  let member: TestUser;
  let other: TestUser;
  let support: TestUser;
  let mod: TestUser;
  let admin: TestUser;
  let superAdmin: TestUser;

  const stepUp = async (user: TestUser) =>
    (await api.post('/admin/step-up', { password: 'password123' }, user).expect(200)).body.token as string;
  const withStepUp = (req: import('supertest').Test, token: string) => req.set('X-Step-Up-Token', token);

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
    db = app.get(DataSource);
  });
  beforeEach(async () => {
    await resetDatabase(app);
    member = await api.register('member');
    other = await api.register('other');
    support = await api.register('support');
    mod = await api.register('mod');
    admin = await api.register('admin_u');
    superAdmin = await api.register('super');
    await api.setRole(support, 'SUPPORT');
    await api.setRole(mod, 'MODERATOR');
    await api.setRole(admin, 'ADMIN');
    await api.setRole(superAdmin, 'SUPER_ADMIN');
  });
  afterAll(() => app.close());

  describe('authorization', () => {
    it('rejects anonymous and ordinary users on every admin area', async () => {
      for (const path of ['/admin/me', '/admin/dashboard', '/admin/users', '/admin/posts', '/admin/reports', '/admin/settings', '/admin/audit-logs', '/admin/system']) {
        await api.get(path).expect(401);
        const res = await api.get(path, member).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    });

    it('exposes role-derived permissions and enforces them server-side', async () => {
      const me = (await api.get('/admin/me', support).expect(200)).body;
      expect(me).toMatchObject({ role: 'SUPPORT', assignableRoles: [] });
      expect(me.permissions).toEqual(expect.arrayContaining(['users.read', 'users.email.read']));
      expect(me.permissions).not.toContain('posts.moderate');

      // Support: read users (with emails), no moderation, no settings, no roles.
      const users = (await api.get('/admin/users?pageSize=50', support).expect(200)).body;
      const team = (await api.get('/admin/users?staff=true', support).expect(200)).body;
      expect(team.items.map((u: { role: string }) => u.role).sort()).toEqual(['ADMIN', 'MODERATOR', 'SUPER_ADMIN', 'SUPPORT']);
      expect(users.items.find((u: { id: string }) => u.id === member.id).email).toBe(`${member.username}@example.com`);
      await api.get('/admin/settings', support).expect(403);
      await api.get('/admin/roles', support).expect(403);
      const post = await api.createPost(member, { content: 'post' });
      await api.post(`/admin/posts/${post.id}/moderation`, { status: 'HIDDEN', reason: 'test reason' }, support).expect(403);

      // Moderators cannot see emails or touch settings / bans.
      const modUsers = (await api.get('/admin/users?pageSize=50', mod).expect(200)).body;
      expect(modUsers.items.every((u: { email: string | null }) => u.email === null)).toBe(true);
      await api.get('/admin/settings', mod).expect(403);
      await api.post(`/admin/users/${member.id}/ban`, { reason: 'nope nope', confirmUsername: member.username }, mod).expect(403);
    });

    it('prevents privilege escalation', async () => {
      const token = await stepUp(admin);
      // Admins cannot grant ADMIN/SUPER_ADMIN, change their own role, or act on equal/higher ranks.
      for (const role of ['ADMIN', 'SUPER_ADMIN']) {
        const res = await withStepUp(api.patch(`/admin/users/${member.id}/role`, { role }, admin), token).expect(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
      await withStepUp(api.patch(`/admin/users/${admin.id}/role`, { role: 'SUPER_ADMIN' }, admin), token).expect(403);
      await withStepUp(api.patch(`/admin/users/${superAdmin.id}/role`, { role: 'USER' }, admin), token).expect(403);
      expect((await api.post(`/admin/users/${superAdmin.id}/suspend`, { reason: 'try to suspend' }, admin).expect(403)).body.code).toBe('INSUFFICIENT_RANK');
      // Admins can grant moderator; the change is audited.
      await withStepUp(api.patch(`/admin/users/${member.id}/role`, { role: 'MODERATOR' }, admin), token).expect(200);
      const audit = (await api.get(`/admin/audit-logs?action=user.role_changed&targetId=${member.id}`, admin).expect(200)).body;
      expect(audit.items[0]).toMatchObject({ actor: { id: admin.id }, metadata: { from: 'USER', to: 'MODERATOR' } });
      // Super admins can grant ADMIN but never demote themselves.
      const superToken = await stepUp(superAdmin);
      await withStepUp(api.patch(`/admin/users/${member.id}/role`, { role: 'ADMIN' }, superAdmin), superToken).expect(200);
      await withStepUp(api.patch(`/admin/users/${superAdmin.id}/role`, { role: 'ADMIN' }, superAdmin), superToken).expect(403);
      // A step-up token is bound to the user and session.
      await withStepUp(api.patch(`/admin/users/${other.id}/role`, { role: 'SUPPORT' }, admin), superToken).expect(403);
    });

    it('requires step-up for sensitive operations and rejects wrong passwords', async () => {
      const res = await api.post(`/admin/users/${member.id}/ban`, { reason: 'serious abuse', confirmUsername: member.username }, admin).expect(403);
      expect(res.body.code).toBe('STEP_UP_REQUIRED');
      expect((await api.post('/admin/step-up', { password: 'wrong-password1' }, admin).expect(403)).body.code).toBe('INVALID_CREDENTIALS');
      await api.get('/admin/me', admin).expect(200); // the session survives a wrong password
      await api.patch('/admin/settings', { general: { platformName: 'X', description: '', supportEmail: '', maintenanceMessage: '', readOnlyMode: false } }, admin).expect(403);
    });

    it('legacy moderation endpoints follow the same rank rules', async () => {
      await api.post(`/moderation/users/${admin.id}/suspend`, undefined, superAdmin).expect(200);
      const otherAdmin = await api.register('admin_two');
      await api.setRole(otherAdmin, 'ADMIN');
      expect((await api.post(`/moderation/users/${otherAdmin.id}/suspend`, undefined, superAdmin).expect(200)).body.status).toBe('SUSPENDED');
      await api.post(`/moderation/users/${superAdmin.id}/suspend`, undefined, superAdmin).expect(403);
    });
  });

  describe('account restrictions', () => {
    it('suspends with expiry, revokes sessions and lifts automatically', async () => {
      const expiresAt = new Date(Date.now() + 2 * 3600_000).toISOString();
      await api.post(`/admin/users/${member.id}/suspend`, { reason: 'Cooling off period', expiresAt }, mod).expect(200);
      await api.get('/users/me', member).expect(401);
      expect((await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(403)).body.message).toMatch(/suspended/);
      await api.post(`/admin/users/${member.id}/suspend`, { reason: 'again please' }, mod).expect(409);

      // Expire it, then sign-in lifts it lazily (the scheduler does the same every minute).
      await db.query(`UPDATE account_restrictions SET starts_at = now() - interval '3 hours', expires_at = now() - interval '1 minute' WHERE user_id = $1`, [member.id]);
      await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(200);
      const detail = (await api.get(`/admin/users/${member.id}`, mod).expect(200)).body;
      expect(detail.user.status).toBe('ACTIVE');
      expect(detail.restrictions[0]).toMatchObject({ type: 'SUSPENSION', active: false, liftReason: 'Expired' });
      expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['user.suspended', 'user.suspension_expired']));
    });

    it('bans with typed confirmation and unbans', async () => {
      const token = await stepUp(admin);
      await withStepUp(api.post(`/admin/users/${member.id}/ban`, { reason: 'Severe abuse', confirmUsername: 'wrong' }, admin), token).expect(400);
      await withStepUp(api.post(`/admin/users/${member.id}/ban`, { reason: 'Severe abuse', confirmUsername: member.username }, admin), token).expect(200);
      expect((await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(403)).body.message).toMatch(/banned/);
      expect((await api.get('/admin/users?status=BANNED', admin).expect(200)).body.total).toBe(1);
      await api.post(`/admin/users/${admin.id}/ban`, { reason: 'self ban', confirmUsername: admin.username }, admin).set('X-Step-Up-Token', token).expect(403);
      await withStepUp(api.post(`/admin/users/${member.id}/unban`, { reason: 'Appeal accepted' }, admin), token).expect(200);
      await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(200);
    });

    it('delivers warnings to the user inbox with read status', async () => {
      const created = (await api.post(`/admin/users/${member.id}/warnings`, { reason: 'SPAM', message: 'Please stop posting repeated links.' }, mod).expect(201)).body;
      expect(created.delivery).toBe('IN_APP_INBOX');
      expect((await api.get('/users/me/inbox/unread-count', member).expect(200)).body.count).toBe(1);
      const inbox = (await api.get('/users/me/inbox', member).expect(200)).body;
      expect(inbox.items[0]).toMatchObject({ kind: 'WARNING', reason: 'SPAM', body: 'Please stop posting repeated links.', isRead: false });
      await api.post('/users/me/inbox/read', {}, member).expect(200);
      const detail = (await api.get(`/admin/users/${member.id}`, mod).expect(200)).body;
      expect(detail.warnings[0].readAt).not.toBeNull();
      // Other users never see it.
      expect((await api.get('/users/me/inbox', other).expect(200)).body.items).toEqual([]);
    });
  });

  describe('content moderation and reports', () => {
    it('hides and restores posts and comments with audited reasons', async () => {
      const post = await api.createPost(member, { content: 'borderline content' });
      const comment = (await api.post(`/posts/${post.id}/comments`, { content: 'nasty reply' }, other).expect(201)).body;
      await api.post(`/comments/${comment.id}/replies`, { content: 'a reply' }, member).expect(201);

      const hidden = (await api.post(`/admin/posts/${post.id}/moderation`, { status: 'HIDDEN', reason: 'Pending review' }, mod).expect(200)).body;
      expect(hidden).toMatchObject({ status: 'HIDDEN', previousStatus: 'ACTIVE' });
      await api.get(`/posts/${post.id}`, other).expect(404);
      const adminView = (await api.get(`/admin/posts/${post.id}`, mod).expect(200)).body;
      expect(adminView).toMatchObject({ content: 'borderline content', post: { moderationStatus: 'HIDDEN' } });
      expect(adminView.history[0]).toMatchObject({ action: 'post.hidden', metadata: { reason: 'Pending review', previousStatus: 'ACTIVE', newStatus: 'HIDDEN' } });
      await api.post(`/admin/posts/${post.id}/moderation`, { status: 'ACTIVE', reason: 'Fine after review' }, mod).expect(200);
      await api.get(`/posts/${post.id}`, other).expect(200);

      // Removed comments stay as placeholders so replies keep their context.
      await api.post(`/admin/comments/${comment.id}/moderation`, { status: 'REMOVED', reason: 'Harassment' }, mod).expect(200);
      const thread = (await api.get(`/posts/${post.id}/comments`).expect(200)).body.items;
      expect(thread[0]).toMatchObject({ id: comment.id, status: 'REMOVED', content: null, hasReplies: true });
      const commentView = (await api.get(`/admin/comments/${comment.id}`, mod).expect(200)).body;
      expect(commentView).toMatchObject({ comment: { content: 'nasty reply', moderationStatus: 'REMOVED' }, replies: [{ content: 'a reply' }] });

      // Moderators cannot moderate their own content.
      const own = await api.createPost(mod, { content: 'mine' });
      await api.post(`/admin/posts/${own.id}/moderation`, { status: 'HIDDEN', reason: 'self moderation' }, mod).expect(403);
    });

    it('removes and restores all of an account’s content in one audited action', async () => {
      const p1 = await api.createPost(member, { content: 'spam one' });
      const p2 = await api.createPost(member, { content: 'spam two' });
      const keep = await api.createPost(other, { content: 'unrelated' });
      const c1 = (await api.post(`/posts/${keep.id}/comments`, { content: 'spam reply' }, member).expect(201)).body;
      await api.post('/reports', { targetType: 'POST', targetId: p1.id, reason: 'SPAM' }, other).expect(201);
      const url = `/admin/users/${member.id}/content/moderation`;
      const body = { scope: 'all', status: 'REMOVED', reason: 'Spam account', resolveReports: true, confirmUsername: member.username };

      expect((await api.post(url, body, mod).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
      const modToken = await stepUp(mod);
      await withStepUp(api.post(url, { ...body, confirmUsername: 'nope' }, mod), modToken).expect(400);
      const supportToken = await stepUp(support);
      await withStepUp(api.post(url, body, support), supportToken).expect(403); // support cannot moderate
      await withStepUp(api.post(`/admin/users/${admin.id}/content/moderation`, { ...body, confirmUsername: admin.username }, mod), modToken).expect(403);
      await withStepUp(api.post(`/admin/users/${mod.id}/content/moderation`, { ...body, confirmUsername: mod.username }, mod), modToken).expect(403);

      const res = (await withStepUp(api.post(url, body, mod), modToken).expect(200)).body;
      expect(res).toMatchObject({ posts: 2, comments: 1, resolvedReports: 1 });
      await api.get(`/posts/${p1.id}`, other).expect(404);
      await api.get(`/posts/${p2.id}`, member).expect(404); // invisible to the author too
      await api.get(`/posts/${keep.id}`, other).expect(200);
      // A removed comment without replies disappears (tombstones are only kept to hold threads together).
      expect((await api.get(`/posts/${keep.id}/comments`).expect(200)).body.items.map((c: { id: string }) => c.id)).not.toContain(c1.id);
      expect((await api.get('/admin/reports?status=PENDING', mod).expect(200)).body.total).toBe(0);
      const history = (await api.get(`/admin/posts/${p2.id}`, mod).expect(200)).body.history;
      expect(history[0]).toMatchObject({ action: 'post.removed', metadata: { bulk: true, batchId: res.batchId, previousStatus: 'ACTIVE' } });
      const summary = (await api.get(`/admin/audit-logs?action=user.content_removed&targetId=${member.id}`, admin).expect(200)).body;
      expect(summary.items[0].metadata).toMatchObject({ scope: 'all', posts: 2, comments: 1 });

      // Running it again changes nothing; restoring brings everything back.
      expect((await withStepUp(api.post(url, body, mod), modToken).expect(200)).body).toMatchObject({ posts: 0, comments: 0 });
      const restored = (await withStepUp(api.post(url, { ...body, status: 'ACTIVE', reason: 'Appeal accepted' }, mod), modToken).expect(200)).body;
      expect(restored).toMatchObject({ posts: 2, comments: 1 });
      await api.get(`/posts/${p1.id}`, other).expect(200);
    });

    it('runs the full report workflow', async () => {
      const post = await api.createPost(member, { content: 'buy cheap followers' });
      await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'SPAM', details: 'spam link' }, other).expect(201);
      await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'SPAM' }, support).expect(201);

      const queue = (await api.get('/admin/reports', mod).expect(200)).body;
      expect(queue.total).toBe(2);
      const reportId = queue.items[0].id;
      expect(queue.items[0]).toMatchObject({ targetType: 'POST', isReel: false, status: 'OPEN', samePendingCount: 2, target: { exists: true, owner: { id: member.id } } });

      // Support can read but not resolve.
      await api.patch(`/admin/reports/${reportId}/assignee`, { assigneeId: mod.id }, support).expect(403);
      // Only report-capable staff can be assigned.
      await api.patch(`/admin/reports/${reportId}/assignee`, { assigneeId: support.id }, mod).expect(400);
      expect((await api.patch(`/admin/reports/${reportId}/assignee`, { assigneeId: mod.id }, mod).expect(200)).body).toMatchObject({ status: 'IN_REVIEW', assignee: { id: mod.id } });
      await api.post(`/admin/reports/${reportId}/notes`, { body: 'Clear spam pattern.' }, mod).expect(201);
      expect((await api.get(`/admin/reports?assigned=me`, mod).expect(200)).body.total).toBe(1);

      const resolved = (await api.post(`/admin/reports/${reportId}/actions`, { action: 'HIDE_CONTENT', reason: 'Spam' }, mod).expect(200)).body;
      expect(resolved.status).toBe('RESOLVED');
      expect((await api.get('/admin/reports', mod).expect(200)).body.total).toBe(0); // related report resolved too
      await api.get(`/posts/${post.id}`, other).expect(404);

      const detail = (await api.get(`/admin/reports/${reportId}`, mod).expect(200)).body;
      expect(detail.notes[0]).toMatchObject({ body: 'Clear spam pattern.', author: { id: mod.id } });
      expect(detail.post.content).toBe('buy cheap followers');
      expect(detail.related).toHaveLength(1);
      expect(detail.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['report.assigned', 'report.resolved', 'post.hidden']));

      // Invalid transitions are rejected; reopening works.
      await api.patch(`/admin/reports/${reportId}/status`, { status: 'IN_REVIEW' }, mod).expect(409);
      expect((await api.patch(`/admin/reports/${reportId}/status`, { status: 'OPEN' }, mod).expect(200)).body.status).toBe('OPEN');
      // Internal notes are never exposed through user-facing APIs.
      expect(JSON.stringify((await api.get(`/posts/${post.id}`, member)).body)).not.toContain('Clear spam pattern');
    });

    it('can warn or suspend the owner from a report', async () => {
      const post = await api.createPost(member, { content: 'abusive' });
      const report = (await api.post('/reports', { targetType: 'POST', targetId: post.id, reason: 'HARASSMENT' }, other).expect(201)).body;
      await api.post(`/admin/reports/${report.id}/actions`, { action: 'WARN_USER', reason: 'First warning', warningMessage: 'Be respectful to others, please.', resolve: false }, mod).expect(200);
      expect((await api.get('/users/me/inbox', member)).body.items[0]).toMatchObject({ kind: 'WARNING', reason: 'HARASSMENT' });
      await api.post(`/admin/reports/${report.id}/actions`, { action: 'SUSPEND_USER', reason: 'Repeat harassment' }, mod).expect(200);
      expect((await api.get(`/admin/users/${member.id}`, mod)).body.user.status).toBe('SUSPENDED');
      // BAN via report still needs step-up (the suspended member's sessions were revoked, so another user reports).
      const r2 = (await api.post('/reports', { targetType: 'USER', targetId: other.id, reason: 'SPAM' }, support).expect(201)).body;
      expect((await api.post(`/admin/reports/${r2.id}/actions`, { action: 'BAN_USER', reason: 'spam', confirmUsername: other.username }, admin).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
    });
  });

  describe('platform settings', () => {
    it('validates, audits and enforces settings and feature flags', async () => {
      const token = await stepUp(admin);
      const current = (await api.get('/admin/settings', admin).expect(200)).body;
      expect(current.settings.features.comments).toBe(true);
      await withStepUp(api.patch('/admin/settings', { posts: { maxLength: 0, maxMedia: 4, defaultVisibility: 'PUBLIC' } }, admin), token).expect(400);
      await withStepUp(api.patch('/admin/settings', { media: { ...current.settings.media, maxImageMb: current.limits.maxImageMb + 1 } }, admin), token).expect(400);
      await withStepUp(api.patch('/admin/settings', { posts: { maxLength: 20, maxMedia: 4, defaultVisibility: 'FOLLOWERS' }, features: { ...current.settings.features, comments: false, registration: false } }, admin), token).expect(200);

      const config = (await api.get('/platform/config').expect(200)).body;
      expect(config).toMatchObject({ postMaxLength: 20, defaultVisibility: 'FOLLOWERS', features: { comments: false, registration: false } });
      await api.post('/posts', { content: 'x'.repeat(21) }, member).expect(400);
      const created = await api.createPost(member, { content: 'short' });
      expect(created.visibility).toBe('FOLLOWERS');
      expect((await api.post(`/posts/${created.id}/comments`, { content: 'hi' }, other).expect(403)).body.code).toBe('FEATURE_DISABLED');
      expect((await api.post('/auth/register', { email: 'new@example.com', username: 'newbie', password: 'password123' }).expect(403)).body.code).toBe('FEATURE_DISABLED');

      const audit = (await api.get('/admin/audit-logs?action=settings.updated', admin).expect(200)).body;
      expect(audit.items[0].metadata.changes.posts.maxLength).toEqual({ from: current.settings.posts.maxLength, to: 20 });
    });

    it('read-only mode blocks members but never staff or sign-in', async () => {
      const token = await stepUp(admin);
      const { settings } = (await api.get('/admin/settings', admin)).body;
      await withStepUp(api.patch('/admin/settings', { general: { ...settings.general, readOnlyMode: true, maintenanceMessage: 'Back soon' } }, admin), token).expect(200);
      const blocked = await api.post('/posts', { content: 'hello' }, member).expect(503);
      expect(blocked.body).toMatchObject({ code: 'READ_ONLY_MODE', message: 'Back soon' });
      await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(200);
      await api.get('/feed/global').expect(200);
      await api.createPost(admin, { content: 'staff can still post' });
      await withStepUp(api.patch('/admin/settings', { general: { ...settings.general, readOnlyMode: false } }, admin), token).expect(200);
      await api.createPost(member, { content: 'members again' });
    });
  });

  describe('announcements', () => {
    it('drafts, publishes once, targets audiences and tracks reads', async () => {
      const draft = (await api.post('/admin/announcements', { title: 'Maintenance', body: 'Sunday 02:00 UTC', audience: 'ALL' }, admin).expect(201)).body;
      expect(draft.status).toBe('DRAFT');
      expect((await api.get('/users/me/inbox', member)).body.items).toEqual([]);
      await api.post(`/admin/announcements/${draft.id}/publish`, undefined, admin).expect(403);
      const token = await stepUp(admin);
      const published = (await withStepUp(api.post(`/admin/announcements/${draft.id}/publish`, undefined, admin), token).expect(200)).body;
      expect(published).toMatchObject({ status: 'PUBLISHED', recipientCount: 6 });
      expect((await withStepUp(api.post(`/admin/announcements/${draft.id}/publish`, undefined, admin), token).expect(409)).body.code).toBe('INVALID_STATE');
      await api.put(`/admin/announcements/${draft.id}`, { title: 'Changed', body: 'nope', audience: 'ALL' }, admin).expect(409);

      expect((await api.get('/users/me/inbox', member)).body.items[0]).toMatchObject({ kind: 'ANNOUNCEMENT', title: 'Maintenance', isRead: false });
      await api.post('/users/me/inbox/read', { items: [{ kind: 'ANNOUNCEMENT', id: draft.id }] }, member).expect(200);
      expect((await api.get(`/admin/announcements/${draft.id}`, admin)).body.readCount).toBe(1);

      const selected = (await api.post('/admin/announcements', { title: 'Beta invite', body: 'You are in!', audience: 'SELECTED', recipientUsernames: [other.username] }, admin).expect(201)).body;
      await api.post('/admin/announcements', { title: 'Bad', body: 'Unknown user', audience: 'SELECTED', recipientUsernames: ['ghost_user'] }, admin).expect(400);
      await withStepUp(api.post(`/admin/announcements/${selected.id}/publish`, undefined, admin), token).expect(200);
      expect((await api.get('/users/me/inbox', other)).body.items.map((i: { title: string }) => i.title)).toEqual(['Beta invite', 'Maintenance']);
      expect((await api.get('/users/me/inbox', member)).body.items.map((i: { title: string }) => i.title)).toEqual(['Maintenance']);

      await api.post(`/admin/announcements/${draft.id}/archive`, undefined, admin).expect(200);
      expect((await api.get('/users/me/inbox', member)).body.items).toEqual([]);
      await api.post('/admin/announcements', { title: 'x', body: 'y', audience: 'ALL' }, mod).expect(403);
    });
  });

  describe('analytics, media, audit and system', () => {
    it('returns real aggregates and validates ranges', async () => {
      await api.createPost(member, { content: 'one' });
      await api.createPost(other, { content: 'two' });
      const overview = (await api.get('/admin/analytics/overview', mod).expect(200)).body;
      expect(overview).toMatchObject({ totalUsers: 6, newUsersToday: 6, totalPosts: 2, pendingReports: 0, bannedAccounts: 0 });
      const from = new Date(Date.now() - 6 * 86400_000).toISOString();
      const to = new Date(Date.now() + 86400_000).toISOString();
      const ts = (await api.get(`/admin/analytics/timeseries?metrics=registrations,posts,active_users&from=${from}&to=${to}`, mod).expect(200)).body;
      const regs = ts.series.find((s: { metric: string }) => s.metric === 'registrations');
      expect(regs.total).toBe(6);
      expect(regs.points.length).toBeGreaterThanOrEqual(7);
      expect(ts.series.find((s: { metric: string }) => s.metric === 'posts').total).toBe(2);
      expect(ts.series.find((s: { metric: string }) => s.metric === 'active_users').note).toMatch(/tracked only since/);
      await api.get(`/admin/analytics/timeseries?metrics=posts&from=${to}&to=${from}`, mod).expect(400);
      await api.get(`/admin/analytics/timeseries?metrics=nope&from=${from}&to=${to}`, mod).expect(400);
      const dashboard = (await api.get('/admin/dashboard', support).expect(200)).body;
      expect(dashboard.recentActions).toEqual([]); // support has no audit.read
      expect(dashboard.recentUsers.length).toBeGreaterThan(0);
    });

    it('previews and cleans up only orphaned media', async () => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      const upload = async () => (await api.http.post('/api/media').set(member.auth).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(201)).body.id as string;
      const orphan = await upload();
      const attached = await upload();
      await api.createPost(member, { content: 'with media', mediaIds: [attached] });
      await db.query(`UPDATE media SET created_at = now() - interval '3 days'`);

      const preview = (await api.get('/admin/media/cleanup', admin).expect(200)).body;
      expect(preview.items.map((m: { id: string }) => m.id)).toEqual([orphan]);
      await api.post('/admin/media/cleanup', { mediaIds: [orphan, attached] }, admin).expect(403);
      const token = await stepUp(admin);
      const result = (await withStepUp(api.post('/admin/media/cleanup', { mediaIds: [orphan, attached] }, admin), token).expect(200)).body;
      expect(result).toMatchObject({ deleted: 1, skipped: 1 });
      expect((await api.get(`/admin/media/${attached}/health`, admin).expect(200)).body.state).toBe('OK');
      const library = (await api.get('/admin/media?usage=POST', admin).expect(200)).body;
      expect(library.items[0]).toMatchObject({ id: attached, usage: { kind: 'POST' } });
      await api.get('/admin/media', mod).expect(403);
    });

    it('keeps the audit log append-only and reports system health', async () => {
      await api.post(`/admin/users/${member.id}/warnings`, { reason: 'OTHER', message: 'A friendly reminder about rules.' }, mod).expect(201);
      await expect(db.query(`UPDATE admin_audit_logs SET action = 'tampered'`)).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM admin_audit_logs`)).rejects.toThrow(/append-only/);
      const logs = (await api.get(`/admin/audit-logs?actorId=${mod.id}`, admin).expect(200)).body;
      expect(logs.items[0]).toMatchObject({ action: 'user.warned', targetType: 'USER', targetLabel: `@${member.username}` });
      await api.get('/admin/audit-logs', mod).expect(403);

      const system = (await api.get('/admin/system', admin).expect(200)).body;
      expect(system.database).toMatchObject({ status: 'OK', pendingMigrations: [] });
      expect(system.storage.status).toBe('OK');
      expect(system.jobs.map((j: { name: string }) => j.name)).toEqual(expect.arrayContaining(['media-orphan-cleanup', 'suspension-expiry']));
      expect(JSON.stringify(system)).not.toMatch(/JWT_SECRET|DB_PASSWORD|password/i);
      const roles = (await api.get('/admin/roles', admin).expect(200)).body;
      expect(roles.roles.find((r: { role: string }) => r.role === 'MODERATOR')).toMatchObject({ memberCount: 1, assignable: true });
      expect(roles.roles.find((r: { role: string }) => r.role === 'ADMIN').assignable).toBe(false);
    });
  });
});
