import type { INestApplication } from '@nestjs/common';
import { Api, createTestApp, resetDatabase, type TestUser } from './setup/test-app.js';

describe('Interactive posts: real poll, quiz and slider results (e2e)', () => {
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
  afterAll(() => app?.close());

  it('starts a poll at zero votes and counts real, one-per-person votes', async () => {
    const post = await api.createPost(alice, { content: 'Hafta sonu? [poll:Nereye gidelim|Deniz|Dağ|Şehir]' });
    expect((await api.get(`/posts/${post.id}/interaction`).expect(200)).body).toEqual({
      kind: 'POLL', counts: [0, 0, 0], total: 0, myResponse: null, average: null, correctCount: null,
    });
    await api.post(`/posts/${post.id}/interaction`, { value: 1 }, bob).expect(200);
    const res = (await api.post(`/posts/${post.id}/interaction`, { value: 1 }, carol).expect(200)).body;
    expect(res).toMatchObject({ counts: [0, 2, 0], total: 2, myResponse: 1 });
    // Voting again does not change or add a vote.
    expect((await api.post(`/posts/${post.id}/interaction`, { value: 0 }, bob).expect(200)).body).toMatchObject({ counts: [0, 2, 0], total: 2, myResponse: 1 });
    // Other viewers see the same totals but no answer of their own.
    expect((await api.get(`/posts/${post.id}/interaction`, alice).expect(200)).body).toMatchObject({ total: 2, myResponse: null });
    expect((await api.get(`/posts/${post.id}/interaction`).expect(200)).body.myResponse).toBeNull();
    await api.post(`/posts/${post.id}/interaction`, { value: 3 }, alice).expect(400); // only 3 options
    await api.post(`/posts/${post.id}/interaction`, { value: 0 }).expect(401);
  });

  it('reports real quiz and slider results', async () => {
    const quiz = await api.createPost(alice, { content: '[quiz:Başkent neresi|1|İstanbul|Ankara|İzmir]' });
    await api.post(`/posts/${quiz.id}/interaction`, { value: 1 }, bob).expect(200);
    expect((await api.post(`/posts/${quiz.id}/interaction`, { value: 0 }, carol).expect(200)).body).toMatchObject({
      kind: 'QUIZ', counts: [1, 1, 0], total: 2, correctCount: 1, myResponse: 0,
    });
    const slider = await api.createPost(alice, { content: '[slider:Bu şarkı nasıl|😐|🔥]' });
    expect((await api.get(`/posts/${slider.id}/interaction`).expect(200)).body).toMatchObject({ kind: 'SLIDER', total: 0, average: null });
    await api.post(`/posts/${slider.id}/interaction`, { value: 80 }, bob).expect(200);
    expect((await api.post(`/posts/${slider.id}/interaction`, { value: 41 }, carol).expect(200)).body).toMatchObject({ total: 2, average: 61, myResponse: 41 });
    await api.post(`/posts/${slider.id}/interaction`, { value: 101 }, bob).expect(400);
  });

  it('follows the post: reposts point at the original, hidden posts and plain posts have no results', async () => {
    const poll = await api.createPost(alice, { content: '[poll:Çay mı kahve mi|Çay|Kahve]' });
    const repost = (await api.post(`/posts/${poll.id}/repost`, undefined, bob).expect(200)).body;
    const repostId = repost.repostId ?? repost.id;
    if (repostId && repostId !== poll.id) await api.post(`/posts/${repostId}/interaction`, { value: 0 }, carol).expect(200);
    else await api.post(`/posts/${poll.id}/interaction`, { value: 0 }, carol).expect(200);
    expect((await api.get(`/posts/${poll.id}/interaction`).expect(200)).body).toMatchObject({ counts: [1, 0], total: 1 });

    const plain = await api.createPost(alice, { content: 'no widget here' });
    await api.get(`/posts/${plain.id}/interaction`).expect(404);

    const secret = await api.createPost(alice, { content: '[poll:Gizli|A|B]', visibility: 'FOLLOWERS' });
    await api.get(`/posts/${secret.id}/interaction`, bob).expect(404);
    await api.post(`/posts/${secret.id}/interaction`, { value: 0 }, bob).expect(404);
  });

  it('deletes responses with the post', async () => {
    const poll = await api.createPost(alice, { content: '[poll:Sil beni|A|B]' });
    await api.post(`/posts/${poll.id}/interaction`, { value: 0 }, bob).expect(200);
    await api.delete(`/posts/${poll.id}`, alice).expect(204);
    await api.get(`/posts/${poll.id}/interaction`).expect(404);
  });
});
