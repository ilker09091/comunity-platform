import type { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import sharp from 'sharp';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';
import { MediaService } from '../src/modules/media/media.service.js';
import { streakNeeded } from '../src/modules/circles/circles.service.js';

describe('Circles: membership, daily question, shared streak and albums', () => {
  let app: INestApplication, api: Api, db: DataSource, png: Buffer;
  let ana: TestUser, ben: TestUser, cem: TestUser, outsider: TestUser;
  beforeAll(async () => {
    app = await createTestApp(); api = new Api(app); db = app.get(DataSource);
    png = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#7c5cff' } }).png().toBuffer();
  });
  beforeEach(async () => {
    await resetDatabase(app);
    [ana, ben, cem, outsider] = [await api.register('ana'), await api.register('ben'), await api.register('cem'), await api.register('outsider')];
  });
  afterAll(() => app?.close());
  const image = async (user: TestUser) =>
    (await api.http.post('/api/media').set(user.auth).attach('file', png, { filename: 'c.png', contentType: 'image/png' }).expect(201)).body;
  const create = async (body: object = {}) =>
    (await api.post('/circles', { name: 'Study crew', emoji: '📚', color: '#7c5cff', ...body }, ana).expect(201)).body;
  const join = async (circle: { inviteCode: string }, user: TestUser) =>
    (await api.post('/circles/join', { code: circle.inviteCode.toLowerCase() }, user).expect(200)).body;
  const circleOf = async (id: string, user: TestUser) => (await api.get(`/circles/${id}`, user).expect(200)).body;

  it('sizes the streak goal by rule and member count', () => {
    expect([1, 2, 3, 6, 7, 30].map(n => streakNeeded('auto', n))).toEqual([0, 2, 3, 6, 5, 20]);
    expect(streakNeeded('half', 5)).toBe(3);
    expect(streakNeeded('most', 4)).toBe(3);
    expect(streakNeeded('all', 9)).toBe(9);
    expect(streakNeeded('half', 2)).toBe(2);
  });

  it('creates, previews, joins and keeps circles private to members', async () => {
    await api.post('/circles', { name: 'x', emoji: '📚', color: '#7c5cff' }, ana).expect(400);
    await api.post('/circles', { name: 'Crew', emoji: '📚', color: 'red' }, ana).expect(400);
    const circle = await create({ kind: 'class', description: '  Room 12  ' });
    expect(circle).toMatchObject({ role: 'owner', memberCount: 1, kind: 'class', description: 'Room 12', streak: { days: 0, needed: 0 } });
    expect(circle.inviteCode).toMatch(/^[A-Z2-9]{8}$/);
    await api.get(`/circles/${circle.id}`, outsider).expect(404);
    const preview = (await api.get(`/circles/invites/${circle.inviteCode}`, outsider).expect(200)).body;
    expect(preview).toMatchObject({ name: 'Study crew', memberCount: 1, circleId: null, full: false });
    expect(preview.members[0].username).toBe(ana.username);
    const joined = await join(circle, ben);
    expect(joined).toMatchObject({ role: 'member', memberCount: 2, streak: { needed: 2 } });
    expect((await join(circle, ben)).memberCount).toBe(2);
    expect((await api.get(`/circles/invites/${circle.inviteCode}`, ben).expect(200)).body.circleId).toBe(circle.id);
    expect((await api.get('/circles', ben).expect(200)).body.map((c: { id: string }) => c.id)).toEqual([circle.id]);
    await api.post('/circles/join', { code: 'ZZZZZZZZ' }, cem).expect(404);
    // Members cannot edit; turning off member invites hides the code from them.
    await api.patch(`/circles/${circle.id}`, { name: 'Mine now' }, ben).expect(403);
    await api.patch(`/circles/${circle.id}`, { membersCanInvite: false, streakRule: 'half' }, ana).expect(200);
    expect((await circleOf(circle.id, ben)).inviteCode).toBeNull();
    const reset = (await api.post(`/circles/${circle.id}/invite/reset`, {}, ana).expect(200)).body;
    expect(reset.inviteCode).not.toBe(circle.inviteCode);
    await api.get(`/circles/invites/${circle.inviteCode}`, cem).expect(404);
  });

  it('refuses to join a full circle', async () => {
    const circle = await create();
    const extra = await Promise.all(Array.from({ length: 29 }, (_, i) => api.register(`fill${i}`)));
    for (const user of extra) await join(circle, user);
    await api.post('/circles/join', { code: circle.inviteCode }, cem).expect(409);
    expect((await api.get(`/circles/invites/${circle.inviteCode}`, cem).expect(200)).body.full).toBe(true);
  });

  it('unlocks today’s answers only after answering, and counts them toward the shared streak', async () => {
    const circle = await create();
    await join(circle, ben);
    await api.post(`/circles/${circle.id}/prompts`, { kind: 'text', text: 'Best thing today?' }, ben).expect(403);
    const custom = (await api.post(`/circles/${circle.id}/prompts`, { kind: 'text', text: 'Best thing today?' }, ana).expect(201)).body;
    const today = (await api.get(`/circles/${circle.id}/today`, ana).expect(200)).body;
    expect(today).toMatchObject({ id: custom.id, kind: 'text', text: 'Best thing today?', answeredCount: 0, memberCount: 2, myAnswer: null });
    expect(today.author.id).toBe(ana.id);
    await api.post(`/circles/${circle.id}/posts`, { promptId: today.id }, ana).expect(400);
    await api.post(`/circles/${circle.id}/posts`, { promptId: today.id, content: 'Sunny walk' }, ana).expect(201);
    await api.post(`/circles/${circle.id}/posts`, { promptId: today.id, content: 'Again' }, ana).expect(409);
    let benView = (await api.get(`/circles/${circle.id}/today`, ben).expect(200)).body;
    expect(benView).toMatchObject({ answeredCount: 1, answers: [], myAnswer: null });
    expect((await circleOf(circle.id, ben)).streak).toMatchObject({ todayCount: 1, needed: 2, contributedToday: false, completedToday: false });
    await api.post(`/circles/${circle.id}/posts`, { promptId: today.id, content: 'Finished my project' }, ben).expect(201);
    benView = (await api.get(`/circles/${circle.id}/today`, ben).expect(200)).body;
    expect(benView.answers.map((a: { content: string }) => a.content).sort()).toEqual(['Finished my project', 'Sunny walk']);
    const after = await circleOf(circle.id, ben);
    expect(after.streak).toMatchObject({ days: 1, best: 1, todayCount: 2, completedToday: true, contributedToday: true });
    expect(after.answeredToday).toBe(true);
    // Answered today, so a new admin question is scheduled for tomorrow and today's stays open.
    const tomorrow = (await api.post(`/circles/${circle.id}/prompts`, { kind: 'poll', text: 'Movie?', options: [' Comedy ', 'Horror'] }, ana).expect(201)).body;
    expect(tomorrow.options).toEqual(['Comedy', 'Horror']);
    expect(tomorrow.day > today.day).toBe(true);
    expect((await api.get(`/circles/${circle.id}/today`, ana).expect(200)).body.id).toBe(today.id);
    await api.post(`/circles/${circle.id}/posts`, { promptId: tomorrow.id, pollChoice: 0 }, ana).expect(409);
    await api.post(`/circles/${circle.id}/prompts`, { kind: 'poll', text: 'One?', options: ['Only'] }, ana).expect(400);
    // Yesterday's question moves to the history, open to everyone.
    await db.query(`UPDATE circle_prompts SET day = day - 1 WHERE id = $1`, [today.id]);
    const history = (await api.get(`/circles/${circle.id}/prompts`, ben).expect(200)).body;
    expect(history.items.map((p: { id: string }) => p.id)).toEqual([today.id]);
    expect(history.items[0].answers).toHaveLength(2);
    await api.post(`/circles/${circle.id}/posts`, { promptId: today.id, content: 'Late' }, cem).expect(404);
  });

  it('tallies poll answers and builds the built-in question for every member alike', async () => {
    const circle = await create();
    await join(circle, ben); await join(circle, cem);
    const builtIn = (await api.get(`/circles/${circle.id}/today`, ana).expect(200)).body;
    expect((await api.get(`/circles/${circle.id}/today`, ben).expect(200)).body.id).toBe(builtIn.id);
    expect(builtIn.author).toBeNull();
    await db.query(`UPDATE circle_prompts SET kind = 'poll', text = 'Tea?', options = '["Tea","Coffee","Neither"]' WHERE id = $1`, [builtIn.id]);
    await api.post(`/circles/${circle.id}/posts`, { promptId: builtIn.id, pollChoice: 3 }, ana).expect(400);
    await api.post(`/circles/${circle.id}/posts`, { promptId: builtIn.id, pollChoice: 1, mediaId: (await image(ana)).id }, ana).expect(400);
    await api.post(`/circles/${circle.id}/posts`, { promptId: builtIn.id, pollChoice: 1 }, ana).expect(201);
    await api.post(`/circles/${circle.id}/posts`, { promptId: builtIn.id, pollChoice: 1 }, ben).expect(201);
    expect((await api.get(`/circles/${circle.id}/today`, cem).expect(200)).body.results).toBeNull();
    await api.post(`/circles/${circle.id}/posts`, { promptId: builtIn.id, pollChoice: 0 }, cem).expect(201);
    expect((await api.get(`/circles/${circle.id}/today`, cem).expect(200)).body.results).toEqual([1, 2, 0]);
  });

  it('keeps the streak through one missed day, resets after two, and tracks the best run', async () => {
    const circle = await create();
    await join(circle, ben);
    await db.query(`UPDATE circles SET streak_days = 4, best_streak = 4, last_completed_day = (now() AT TIME ZONE 'UTC')::date - 2 WHERE id = $1`, [circle.id]);
    expect((await circleOf(circle.id, ana)).streak).toMatchObject({ days: 4, atRisk: true });
    await api.post(`/circles/${circle.id}/posts`, { content: 'hi' }, ana).expect(201);
    await api.post(`/circles/${circle.id}/posts`, { content: 'hey' }, ben).expect(201);
    expect((await circleOf(circle.id, ana)).streak).toMatchObject({ days: 5, best: 5, atRisk: false, completedToday: true });
    await api.post(`/circles/${circle.id}/posts`, { content: 'more' }, ben).expect(201);
    expect((await circleOf(circle.id, ana)).streak.days).toBe(5);
    await db.query(`UPDATE circles SET last_completed_day = (now() AT TIME ZONE 'UTC')::date - 3 WHERE id = $1`, [circle.id]);
    await db.query('DELETE FROM circle_activity WHERE circle_id = $1', [circle.id]);
    expect((await circleOf(circle.id, ana)).streak).toMatchObject({ days: 0, best: 5 });
    await api.post(`/circles/${circle.id}/posts`, { content: 'back' }, ana).expect(201);
    await api.post(`/circles/${circle.id}/posts`, { content: 'again' }, ben).expect(201);
    expect((await circleOf(circle.id, ana)).streak).toMatchObject({ days: 1, best: 5 });
  });

  it('feed posts respect authorship, admin moderation and blocks', async () => {
    const circle = await create();
    await join(circle, ben); await join(circle, cem);
    await api.post(`/circles/${circle.id}/posts`, {}, ben).expect(400);
    const post = (await api.post(`/circles/${circle.id}/posts`, { content: '  Exam on Friday \n\n\n\n\n!' }, ben).expect(201)).body;
    expect(post).toMatchObject({ content: 'Exam on Friday \n\n\n!', canDelete: true });
    expect((await api.get(`/circles/${circle.id}/posts`, cem).expect(200)).body.items[0].canDelete).toBe(false);
    await api.delete(`/circles/${circle.id}/posts/${post.id}`, cem).expect(403);
    await api.post(`/users/${ben.id}/block`, {}, cem).expect(200);
    expect((await api.get(`/circles/${circle.id}/posts`, cem).expect(200)).body.items).toHaveLength(0);
    expect((await api.get(`/circles/${circle.id}/posts`, ana).expect(200)).body.items[0].canDelete).toBe(true);
    await api.delete(`/circles/${circle.id}/posts/${post.id}`, ana).expect(204);
    expect((await api.get(`/circles/${circle.id}/posts`, ana).expect(200)).body.items).toHaveLength(0);
    await api.get(`/circles/${circle.id}/posts`, outsider).expect(404);
    await api.post(`/circles/${circle.id}/posts`, { content: 'let me in' }, outsider).expect(404);
    expect((await circleOf(circle.id, ana)).hasNew).toBe(false);
  });

  it('albums accept uploads while open, keep their media safe from cleanup and delete it with them', async () => {
    const circle = await create();
    await join(circle, ben);
    const album = (await api.post(`/circles/${circle.id}/albums`, { title: 'School trip', hours: 48 }, ben).expect(201)).body;
    expect(album).toMatchObject({ title: 'School trip', open: true, itemCount: 0, canDelete: true });
    await api.post(`/circles/${circle.id}/posts`, { albumId: album.id, content: 'no photo' }, ana).expect(400);
    const photo = await image(ana);
    const item = (await api.post(`/circles/${circle.id}/posts`, { albumId: album.id, mediaId: photo.id }, ana).expect(201)).body;
    expect(item.media.id).toBe(photo.id);
    await api.post(`/circles/${circle.id}/posts`, { content: 'reuse', mediaId: photo.id }, ana).expect(409);
    const listed = (await api.get(`/circles/${circle.id}/albums`, ben).expect(200)).body.items[0];
    expect(listed).toMatchObject({ itemCount: 1, preview: [{ id: photo.id }] });
    expect((await api.get(`/circles/${circle.id}/albums/${album.id}/items`, ben).expect(200)).body.items).toHaveLength(1);
    // The hourly orphan sweep must not take photos that live in a circle.
    await db.query(`UPDATE media SET created_at = now() - interval '30 days' WHERE id = $1`, [photo.id]);
    await app.get(MediaService).cleanupOrphans();
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(1);
    await db.query(`UPDATE circle_albums SET closes_at = now() - interval '1 minute' WHERE id = $1`, [album.id]);
    await api.post(`/circles/${circle.id}/posts`, { albumId: album.id, mediaId: (await image(ben)).id }, ben).expect(409);
    await api.delete(`/circles/${circle.id}/albums/${album.id}`, ana).expect(204);
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(0);
    for (let i = 0; i < 5; i++) await api.post(`/circles/${circle.id}/albums`, { title: `A${i}`, hours: 1 }, ana).expect(201);
    await api.post(`/circles/${circle.id}/albums`, { title: 'Too many', hours: 1 }, ana).expect(409);
  });

  it('handles roles, ownership hand-over, removal, leaving and account deletion', async () => {
    const circle = await create();
    await join(circle, ben); await join(circle, cem);
    await api.post(`/circles/${circle.id}/members/${cem.id}/role`, { role: 'admin' }, ben).expect(403);
    await api.post(`/circles/${circle.id}/members/${ben.id}/role`, { role: 'admin' }, ana).expect(200);
    await api.delete(`/circles/${circle.id}/members/${ana.id}`, ben).expect(403);
    await api.delete(`/circles/${circle.id}/members/${cem.id}`, ben).expect(204);
    expect((await circleOf(circle.id, ana)).memberCount).toBe(2);
    await join(circle, cem);
    const members = (await api.post(`/circles/${circle.id}/members/${cem.id}/role`, { role: 'owner' }, ana).expect(200)).body;
    expect(members.map((m: { user: { id: string }; role: string }) => [m.user.id, m.role])).toEqual([[cem.id, 'owner'], [ana.id, 'admin'], [ben.id, 'admin']]);
    await api.delete(`/circles/${circle.id}`, ana).expect(403);
    // The owner's account disappears: the longest-standing admin takes over.
    await db.query('DELETE FROM users WHERE id = $1', [cem.id]);
    expect((await circleOf(circle.id, ana)).role).toBe('owner');
    await api.post(`/circles/${circle.id}/leave`, {}, ana).expect(204);
    expect((await circleOf(circle.id, ben)).role).toBe('owner');
    const photo = await image(ben);
    await api.post(`/circles/${circle.id}/posts`, { mediaId: photo.id }, ben).expect(201);
    await api.post(`/circles/${circle.id}/leave`, {}, ben).expect(204);
    expect((await db.query('SELECT 1 FROM circles WHERE id = $1', [circle.id])).length).toBe(0);
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(0);
  });

  it('lets the owner delete the circle with all of its uploads', async () => {
    const circle = await create();
    await join(circle, ben);
    const photo = await image(ben);
    await api.post(`/circles/${circle.id}/posts`, { mediaId: photo.id, content: 'look' }, ben).expect(201);
    await api.delete(`/circles/${circle.id}`, ben).expect(403);
    await api.delete(`/circles/${circle.id}`, ana).expect(204);
    await api.get(`/circles/${circle.id}`, ben).expect(404);
    expect((await db.query('SELECT 1 FROM media WHERE id = $1', [photo.id])).length).toBe(0);
  });
});
