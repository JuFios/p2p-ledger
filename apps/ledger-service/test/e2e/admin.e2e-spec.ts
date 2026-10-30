import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createApp, deposit, withdraw } from './helpers';
import {
  account,
  Account,
  balanceOf,
  capture,
  freeze,
  loginAdmin,
  placeHold,
  reconciliation,
  release,
  walletEvents,
} from './ledger-helpers';

describe('Admin (e2e)', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createApp();
    admin = await loginAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('користувач без ролі admin отримує 403, без токена — 401', async () => {
    const a = await account(app);
    const server = app.getHttpServer();
    const calls = [
      () => request(server).get(`/admin/wallets/${a.walletId}/events`),
      () => request(server).get('/admin/reconciliation'),
      () => request(server).post(`/admin/wallets/${a.walletId}/freeze`),
    ];
    for (const call of calls) {
      await call().expect(401);
      await call().set('Authorization', `Bearer ${a.token}`).expect(403);
    }
    expect((await balanceOf(app, a)).balance).toBe('100.00');
  });

  it('event-лог гаманця хронологічний, payload у поточній версії схеми', async () => {
    const a = await account(app);
    await withdraw(app, a.token, a.walletId, 30);
    await deposit(app, a.token, a.walletId, 5);
    const events = await walletEvents(app, admin, a.walletId);
    expect(events.map((e) => e.type)).toEqual([
      'WalletOpened',
      'MoneyDeposited',
      'MoneyWithdrawn',
      'MoneyDeposited',
    ]);
    const positions = events.map((e) => BigInt(e.globalPosition));
    expect([...positions].sort((x, y) => (x < y ? -1 : 1))).toEqual(positions);
    expect(events[1]).toMatchObject({
      schemaVersion: 2,
      payload: { amountMinor: '10000', currency: 'USD' },
    });

    await request(app.getHttpServer())
      .get(`/admin/wallets/${randomUUID()}/events`)
      .set('Authorization', `Bearer ${admin}`)
      .expect(404);
  });

  it('заморожений гаманець не приймає й не віддає гроші; повторний freeze нічого не пише', async () => {
    const a = await account(app);
    const first = await freeze(app, admin, a.walletId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ id: a.walletId, frozen: true });
    await freeze(app, admin, a.walletId).then((r) => expect(r.status).toBe(200));

    for (const res of [
      await deposit(app, a.token, a.walletId, 10),
      await withdraw(app, a.token, a.walletId, 10),
    ]) {
      expect([res.status, res.body.code]).toEqual([409, 'WALLET_FROZEN']);
    }
    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '100.00',
      held: '0.00',
    });
    const types = (await walletEvents(app, admin, a.walletId)).map((e) => e.type);
    expect(types.filter((t) => t === 'WalletFrozen')).toHaveLength(1);
  });

  it('reconciliation після серії випадкових операцій: Σ D = Σ C і проєкція = перебудова', async () => {
    const currencies = ['USD', 'EUR', 'UAH'];
    const accounts: Account[] = [];
    for (const currency of currencies) {
      accounts.push(await account(app, currency, 500));
      accounts.push(await account(app, currency, 0));
    }
    const random = (n: number) => Math.floor(Math.random() * n);
    for (let i = 0; i < 40; i++) {
      const from = accounts[random(accounts.length)];
      const to = accounts[random(accounts.length)];
      const currency = currencies[Math.floor(accounts.indexOf(from) / 2)];
      const toCurrency = currencies[Math.floor(accounts.indexOf(to) / 2)];
      const amount = 1 + random(5000) / 100;
      switch (random(4)) {
        case 0:
          await deposit(app, from.token, from.walletId, amount);
          break;
        case 1:
          await withdraw(app, from.token, from.walletId, amount);
          break;
        default: {
          const minor = String(Math.round(amount * 100));
          const { res, holdId } = await placeHold(app, from, minor, { currency });
          if (res.status !== 201) break;
          if (random(2) === 0) {
            await release(app, holdId, 'RANDOM');
          } else {
            const toMinor =
              currency === toCurrency ? minor : String(Math.max(1, Math.floor(Number(minor) * 0.9)));
            await capture(app, holdId, to, toMinor, { toCurrency, fxRate: 0.9 });
          }
        }
      }
    }

    const res = await reconciliation(app, admin);
    expect(res.status).toBe(200);
    expect(res.body.projectionMismatches).toEqual([]);
    for (const row of res.body.perCurrency) {
      expect(row.diff).toBe('0.00');
      expect(row.debits).toBe(row.credits);
    }
    expect(res.body.ok).toBe(true);
  });

  it('reconciliation виявляє розбіжність проєкції з event-логом', async () => {
    const a = await account(app);
    const dataSource = app.get(DataSource);
    await dataSource.query(
      'UPDATE wallet_balances SET available = available + 1 WHERE wallet_id = $1',
      [a.walletId],
    );
    try {
      const res = await reconciliation(app, admin);
      expect(res.body.ok).toBe(false);
      expect(res.body.projectionMismatches).toEqual([
        {
          walletId: a.walletId,
          rebuilt: { available: '100.00', held: '0.00' },
          projection: { available: '100.01', held: '0.00' },
        },
      ]);
    } finally {
      await dataSource.query(
        'UPDATE wallet_balances SET available = available - 1 WHERE wallet_id = $1',
        [a.walletId],
      );
    }
  });

  it('reconciliation за період і валідація меж', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const res = await reconciliation(app, admin, { from: future });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ from: future, perCurrency: [] });
    await reconciliation(app, admin, { from: 'yesterday' }).then((r) =>
      expect(r.status).toBe(400),
    );
  });
});
