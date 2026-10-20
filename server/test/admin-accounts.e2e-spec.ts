import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, TestUser } from './setup/test-app.js';

describe('Admin account management: sessions, profile clean-up, notes and activity (e2e)', () => {
  let app: INestApplication, api: Api, db: DataSource;
  let member: TestUser, other: TestUser, support: TestUser, mod: TestUser, admin: TestUser;
  beforeAll(async () => { app = await createTestApp(); api = new Api(app); db = app.get(DataSource); });
  beforeEach(async () => {
    await resetDatabase(app);
    [member, other, support, mod, admin] = [await api.register('member'), await api.register('other'), await api.register('support'),
      await api.register('mod'), await api.register('admin_u')];
    await api.setRole(support, 'SUPPORT'); await api.setRole(mod, 'MODERATOR'); await api.setRole(admin, 'ADMIN');
  });
  afterAll(() => app.close());
  const audit = async (action: string) =>
    (await db.query('SELECT metadata FROM admin_audit_logs WHERE action = $1 ORDER BY created_at DESC', [action])) as { metadata: Record<string, unknown> }[];

  it('lists devices, hides IPs from roles without contact access and signs the account out', async () => {
    await api.http.post('/api/auth/login').set('User-Agent', 'QA Phone').send({ identifier: member.username, password: 'password123' }).expect(200);
    const sessions = (await api.get(`/admin/users/${member.id}/sessions`, admin).expect(200)).body;
    expect(sessions.length).toBeGreaterThanOrEqual(2);
    expect(sessions.every((s: { active: boolean }) => s.active)).toBe(true);
    expect(sessions.some((s: { userAgent: string | null }) => s.userAgent === 'QA Phone')).toBe(true);
    // Moderators lack users.email.read: no IP addresses.
    expect((await api.get(`/admin/users/${member.id}/sessions`, mod).expect(200)).body.every((s: { ipAddress: null }) => s.ipAddress === null)).toBe(true);
    await api.post(`/admin/users/${member.id}/sessions/revoke`, { reason: 'Reported stolen phone' }, support).expect(403);
    await api.post(`/admin/users/${admin.id}/sessions/revoke`, { reason: 'Not allowed upward' }, mod).expect(403);
    const one = sessions[0].id;
    expect((await api.post(`/admin/users/${member.id}/sessions/${one}/revoke`, { reason: 'Unknown device' }, mod).expect(200)).body.revoked).toBe(1);
    await api.post(`/admin/users/${member.id}/sessions/${one}/revoke`, { reason: 'Unknown device' }, mod).expect(404);
    const all = (await api.post(`/admin/users/${member.id}/sessions/revoke`, { reason: 'Account recovery' }, mod).expect(200)).body;
    expect(all.revoked).toBe(sessions.length - 1);
    await api.get('/users/me', member).expect(401);
    expect((await audit('user.sessions.revoked'))[0].metadata).toMatchObject({ reason: 'Account recovery', count: sessions.length - 1 });
  });

  it('resets a password with step-up, signs every device out and never stores the password in the audit log', async () => {
    const stepUp = async (user: TestUser) => (await api.post('/admin/step-up', { password: 'password123' }, user).expect(200)).body.token as string;
    await api.post(`/admin/users/${member.id}/password`, { reason: 'Locked out' }, admin).expect(403);
    await api.post(`/admin/users/${member.id}/password`, { reason: 'Locked out' }, mod).expect(403);
    const token = await stepUp(admin);
    await api.http.post(`/api/admin/users/${member.id}/password`).set(admin.auth).set('X-Step-Up-Token', token)
      .send({ reason: 'Weak password', password: 'short' }).expect(400);
    const generated = (await api.http.post(`/api/admin/users/${member.id}/password`).set(admin.auth).set('X-Step-Up-Token', token)
      .send({ reason: 'Locked out of email' }).expect(200)).body;
    expect(generated.temporaryPassword).toMatch(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{14}$/);
    expect(generated.revokedSessions).toBeGreaterThanOrEqual(1);
    await api.get('/users/me', member).expect(401);
    await api.post('/auth/login', { identifier: member.username, password: 'password123' }).expect(401);
    await api.post('/auth/login', { identifier: member.username, password: generated.temporaryPassword }).expect(200);
    const chosen = (await api.http.post(`/api/admin/users/${member.id}/password`).set(admin.auth).set('X-Step-Up-Token', token)
      .send({ reason: 'User asked by phone', password: 'chosenPass42' }).expect(200)).body;
    expect(chosen.temporaryPassword).toBeNull();
    await api.post('/auth/login', { identifier: member.username, password: 'chosenPass42' }).expect(200);
    await api.http.post(`/api/admin/users/${admin.id}/password`).set(admin.auth).set('X-Step-Up-Token', token).send({ reason: 'Self' }).expect(403);
    const entries = await audit('user.password.reset');
    expect(entries).toHaveLength(2);
    expect(JSON.stringify(entries)).not.toContain('chosenPass42');
    expect(JSON.stringify(entries)).not.toContain(generated.temporaryPassword);
  });

  it('cleans up a profile with an audited reason and the previous values', async () => {
    const png = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#f00' } }).png().toBuffer();
    await api.http.post('/api/users/me/avatar').set(member.auth).attach('file', png, { filename: 'a.png', contentType: 'image/png' }).expect(200);
    const avatarId = (await db.query('SELECT avatar_media_id FROM users WHERE id = $1', [member.id]))[0].avatar_media_id;
    expect(avatarId).toBeTruthy();
    await api.patch(`/admin/users/${member.id}/profile`, { reason: 'Offensive name', displayName: 'x' }, mod).expect(403);
    await api.patch(`/admin/users/${member.id}/profile`, { displayName: 'Clean' }, admin).expect(400);
    await api.patch(`/admin/users/${member.id}/profile`, { reason: 'Impersonation', username: other.username.toUpperCase() }, admin).expect(409);
    const result = (await api.patch(`/admin/users/${member.id}/profile`,
      { reason: 'Offensive profile', displayName: 'Community member', bio: '', website: null, removeAvatar: true, username: 'renamed_member' }, admin).expect(200)).body;
    expect(result.changed.sort()).toEqual(['avatar', 'displayName', 'username']);
    const profile = (await api.get('/users/renamed_member', admin).expect(200)).body;
    expect(profile).toMatchObject({ displayName: 'Community member', avatarUrl: null });
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [avatarId])).length).toBe(0);
    const [entry] = await audit('user.profile.updated');
    expect(entry.metadata).toMatchObject({ reason: 'Offensive profile', previous: { username: member.username } });
    expect((await api.patch(`/admin/users/${member.id}/profile`, { reason: 'No-op', displayName: 'Community member' }, admin).expect(200)).body.changed).toEqual([]);
    await api.patch(`/admin/users/${admin.id}/profile`, { reason: 'Self edit', bio: 'x' }, admin).expect(403);
  });

  it('keeps internal notes that only staff can read and delete', async () => {
    await api.get(`/admin/users/${member.id}/notes`, member).expect(403);
    await api.post(`/admin/users/${member.id}/notes`, { body: 'Called support twice' }, support).expect(403);
    const note = (await api.post(`/admin/users/${member.id}/notes`, { body: '  Second spam warning, watch replies  ' }, mod).expect(201)).body;
    expect(note).toMatchObject({ body: 'Second spam warning, watch replies', canDelete: true, author: { id: mod.id } });
    const seen = (await api.get(`/admin/users/${member.id}/notes`, support).expect(200)).body;
    expect(seen).toHaveLength(1);
    expect(seen[0].canDelete).toBe(false);
    const second = (await api.post(`/admin/users/${member.id}/notes`, { body: 'Admin follow-up' }, admin).expect(201)).body;
    await api.delete(`/admin/users/${member.id}/notes/${second.id}`, mod).expect(403);
    await api.delete(`/admin/users/${member.id}/notes/${note.id}`, admin).expect(204);
    expect((await api.get(`/admin/users/${member.id}/notes`, admin).expect(200)).body.map((n: { id: string }) => n.id)).toEqual([second.id]);
  });

  it('summarizes usage without exposing message contents', async () => {
    await api.post(`/users/${other.id}/follow`, {}, member).expect(200);
    await api.post(`/users/${member.id}/follow`, {}, other).expect(200);
    await api.post(`/messages/${other.id}`, { content: 'private words' }, member).expect(201);
    await api.post(`/messages/${member.id}`, { content: 'reply' }, other).expect(201);
    await api.post('/posts', { content: 'hello world' }, member).expect(201);
    const circle = (await api.post('/circles', { name: 'Team', emoji: '⚽', color: '#258cf4' }, member).expect(201)).body;
    const activity = (await api.get(`/admin/users/${member.id}/activity`, support).expect(200)).body;
    expect(activity).toMatchObject({ messagesSent: 1, messagesReceived: 1, conversations: 1, recentCalls: 0 });
    expect(activity.postsByDay).toHaveLength(14);
    expect(activity.postsByDay.at(-1)).toBe(1);
    expect(activity.circles).toEqual([expect.objectContaining({ id: circle.id, role: 'owner', memberCount: 1 })]);
    expect(JSON.stringify(activity)).not.toContain('private words');
    await api.get(`/admin/users/00000000-0000-4000-8000-000000000000/activity`, support).expect(404);
  });
});
