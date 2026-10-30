import { INestApplication } from '@nestjs/common';
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

  it('B1: паралельні withdraw не дають double spend', async () => {
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

  it('B1: паралельні deposit не губляться (lost update)', async () => {
    const { token } = await registerUser(app);
    const wallet = await createWallet(app, token);

    const results = await Promise.all(
      Array.from({ length: 20 }, () => deposit(app, token, wallet.id, 10)),
    );

    expect(results.every((r) => r.status === 201)).toBe(true);
    const final = await getWallet(app, token, wallet.id);
    expect(final.body.balance).toBe('200.00');
  });
});
