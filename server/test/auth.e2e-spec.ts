import { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase } from './setup/test-app.js';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let api: Api;

  beforeAll(async () => {
    app = await createTestApp();
    api = new Api(app);
  });
  beforeEach(() => resetDatabase(app));
  afterAll(() => app.close());

  it('registers, returns tokens and a private profile, and never leaks the password hash', async () => {
    const res = await api
      .post('/auth/register', { email: 'Jane@Example.com', username: 'Jane_Doe', password: 'password123' })
      .expect(201);
    expect(res.body).toMatchObject({ tokenType: 'Bearer', user: { username: 'Jane_Doe', email: 'jane@example.com' } });
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.refreshToken).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
  });

  it('rejects duplicate usernames case-insensitively and duplicate emails', async () => {
    await api.post('/auth/register', { email: 'a@example.com', username: 'Alice', password: 'password123' }).expect(201);
    const dupName = await api.post('/auth/register', { email: 'b@example.com', username: 'alice', password: 'password123' }).expect(409);
    expect(dupName.body.code).toBe('ACCOUNT_CONFLICT');
    const dupEmail = await api.post('/auth/register', { email: 'A@EXAMPLE.COM', username: 'bob', password: 'password123' }).expect(409);
    expect(dupEmail.body.code).toBe('ACCOUNT_CONFLICT');
  });

  it('returns structured validation errors', async () => {
    const res = await api.post('/auth/register', { email: 'nope', username: 'a', password: 'short', admin: true }).expect(400);
    expect(res.body).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR', message: 'Validation failed' });
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'username', 'password', 'admin']));
  });

  it('rejects reserved usernames', async () => {
    await api.post('/auth/register', { email: 'me@example.com', username: 'me', password: 'password123' }).expect(400);
    await api.post('/auth/register', { email: 'adm@example.com', username: 'admin', password: 'password123' }).expect(409);
  });

  it('logs in by email or username with identical errors for unknown users and wrong passwords', async () => {
    const user = await api.register('login');
    await api.post('/auth/login', { identifier: `${user.username}@example.com`, password: 'password123' }).expect(200);
    await api.post('/auth/login', { identifier: user.username.toUpperCase(), password: 'password123' }).expect(200);

    const wrong = await api.post('/auth/login', { identifier: user.username, password: 'wrong-password1' }).expect(401);
    const unknown = await api.post('/auth/login', { identifier: 'ghost_user', password: 'wrong-password1' }).expect(401);
    expect(wrong.body).toEqual(unknown.body);
    expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
  });

  it('protects endpoints and rejects malformed tokens', async () => {
    await api.get('/users/me').expect(401);
    await api.http.get('/api/users/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
    await api.http.get('/api/users/me').set('Authorization', 'Basic abc').expect(401);
    // Public routes still work anonymously.
    await api.get('/feed/global').expect(200);
  });

  it('rotates refresh tokens and revokes the session when a used token is replayed', async () => {
    const user = await api.register('refresh');
    const first = await api.post('/auth/refresh', { refreshToken: user.refreshToken }).expect(200);
    expect(first.body.refreshToken).not.toBe(user.refreshToken);
    const rotated = api.asUser(first.body);
    await api.get('/users/me', rotated).expect(200);

    // Replaying the already-used token is treated as theft.
    const replay = await api.post('/auth/refresh', { refreshToken: user.refreshToken }).expect(401);
    expect(replay.body.code).toBe('INVALID_REFRESH_TOKEN');
    // The whole session (including the newest tokens) is now revoked.
    await api.get('/users/me', rotated).expect(401);
    await api.post('/auth/refresh', { refreshToken: rotated.refreshToken }).expect(401);
  });

  it('logout revokes the access token immediately (server-side)', async () => {
    const user = await api.register('logout');
    await api.post('/auth/logout', undefined, user).expect(204);
    await api.get('/users/me', user).expect(401);
    await api.post('/auth/refresh', { refreshToken: user.refreshToken }).expect(401);
  });

  it('requires authentication and binds background sessions to the caller', async () => {
    await api.post('/auth/background-session').expect(401);
    const caller = await api.register('background');
    const other = await api.register('other');
    const result = await api.post('/auth/background-session', { userId: other.id }, caller).expect(200);
    const background = api.asUser(result.body);
    expect(background.id).toBe(caller.id);
    expect(background.refreshToken).not.toBe(caller.refreshToken);
    await api.get('/users/me', background).expect(200);
    // Each refresh chain remains valid when the other one rotates.
    const rotated = await api.post('/auth/refresh', { refreshToken: background.refreshToken }).expect(200);
    await api.post('/auth/refresh', { refreshToken: caller.refreshToken }).expect(200);
    await api.get('/users/me', api.asUser(rotated.body)).expect(200);
  });

  it('revokes background sessions with logout-all and password changes', async () => {
    const caller = await api.register('background_revoke');
    const background = api.asUser((await api.post('/auth/background-session', undefined, caller).expect(200)).body);
    await api.post('/auth/change-password', { currentPassword: 'password123', newPassword: 'newpassword1' }, caller).expect(204);
    await api.get('/users/me', background).expect(401);
    await api.post('/auth/refresh', { refreshToken: background.refreshToken }).expect(401);
    const second = api.asUser((await api.post('/auth/background-session', undefined, caller).expect(200)).body);
    await api.post('/auth/logout-all', undefined, caller).expect(204);
    await api.get('/users/me', second).expect(401);
    await api.post('/auth/refresh', { refreshToken: second.refreshToken }).expect(401);
  });

  it('change-password requires the current password and revokes other sessions', async () => {
    const user = await api.register('pw');
    const other = api.asUser(
      (await api.post('/auth/login', { identifier: user.username, password: 'password123' }).expect(200)).body,
    );

    const bad = await api.post('/auth/change-password', { currentPassword: 'nope', newPassword: 'newpassword1' }, user).expect(400);
    expect(bad.body.code).toBe('WRONG_PASSWORD');

    await api.post('/auth/change-password', { currentPassword: 'password123', newPassword: 'newpassword1' }, user).expect(204);
    await api.get('/users/me', user).expect(200);
    await api.get('/users/me', other).expect(401);
    await api.post('/auth/login', { identifier: user.username, password: 'password123' }).expect(401);
    await api.post('/auth/login', { identifier: user.username, password: 'newpassword1' }).expect(200);
  });
});
