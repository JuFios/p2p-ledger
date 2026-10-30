import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createApp,
  createWallet,
  deposit,
  getWallet,
  registerUser,
  withdraw,
} from './helpers';

describe('Wallets concurrency (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('паралельні withdraw не дають double spend', async () => {
    const { token } = await registerUser(app);
    const wallet = await createWallet(app, token);
    await deposit(app, token, wallet.id, 100);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => withdraw(app, token, wallet.id, 10)),
    );
    const statuses = results.map((r) => r.status);

    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 400)).toHaveLength(10);
    const final = await getWallet(app, token, wallet.id);
    expect(final.body.balance).toBe('0.00');
  });

  it('паралельні deposit не губляться (lost update)', async () => {
    const { token } = await registerUser(app);
    const wallet = await createWallet(app, token);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => deposit(app, token, wallet.id, 10)),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    const final = await getWallet(app, token, wallet.id);
    expect(final.body.balance).toBe('200.00');
  });

  it('паралельні POST /wallets не створюють дублікатів гаманця', async () => {
    const { token } = await registerUser(app);

    const wallets = await Promise.all(
      Array.from({ length: 10 }, () => createWallet(app, token, 'UAH')),
    );

    expect(new Set(wallets.map((w) => w.id)).size).toBe(1);
    const list = await request(app.getHttpServer())
      .get('/wallets')
      .set('Authorization', `Bearer ${token}`);
    expect(list.body).toHaveLength(1);
  });
});
