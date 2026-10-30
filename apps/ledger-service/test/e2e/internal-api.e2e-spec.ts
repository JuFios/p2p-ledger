import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp, registerUser } from './helpers';
import { account, internal } from './ledger-helpers';

describe('Internal API (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('недоступний з токеном користувача або з невірним внутрішнім токеном', async () => {
    const a = await account(app);
    const server = app.getHttpServer();
    const calls = [
      () => request(server).get(`/internal/wallets/${a.walletId}`),
      () => request(server).post('/internal/wallets/ensure').send({ userId: a.userId, currency: 'EUR' }),
      () => request(server).post('/internal/holds').send({}),
      () => request(server).get(`/internal/users/by-email/x@example.com`),
    ];
    for (const call of calls) {
      await call().set('Authorization', `Bearer ${a.token}`).expect(401);
      await call().set('x-internal-token', 'wrong-token').expect(401);
    }
  });

  it('знаходить користувача за email', async () => {
    const { email } = await registerUser(app);
    const res = await internal(app)
      .get(`/internal/users/by-email/${encodeURIComponent(email)}`)
      .expect(200);
    expect(res.body).toEqual({ userId: expect.any(String), email });

    const missing = await internal(app).get('/internal/users/by-email/nobody@example.com');
    expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
  });

  it('ensure створює гаманець при першій потребі й повертає наявний', async () => {
    const a = await account(app);
    const first = await internal(app)
      .post('/internal/wallets/ensure', { userId: a.userId, currency: 'UAH' })
      .expect(201);
    expect(first.body).toEqual({
      walletId: expect.any(String),
      ownerId: a.userId,
      currency: 'UAH',
      frozen: false,
    });
    const again = await internal(app)
      .post('/internal/wallets/ensure', { userId: a.userId, currency: 'UAH' })
      .expect(201);
    expect(again.body.walletId).toBe(first.body.walletId);

    await internal(app)
      .get(`/internal/wallets/${a.walletId}`)
      .expect(200, {
        walletId: a.walletId,
        ownerId: a.userId,
        currency: 'USD',
        frozen: false,
        available: '100.00',
        held: '0.00',
      });
    const missing = await internal(app).get(`/internal/wallets/${randomUUID()}`);
    expect([missing.status, missing.body.code]).toEqual([404, 'NOT_FOUND']);
  });
});
