import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createApp } from './helpers';
import { account, balanceOf } from './ledger-helpers';

describe('Idempotency-Key on deposit/withdraw (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (
    token: string,
    walletId: string,
    op: 'deposit' | 'withdraw',
    amount: number,
    key?: string,
  ) => {
    const req = request(app.getHttpServer())
      .post(`/wallets/${walletId}/${op}`)
      .set('Authorization', `Bearer ${token}`);
    if (key !== undefined) req.set('Idempotency-Key', key);
    return req.send({ amount });
  };

  it('повтор з тим самим ключем повертає той самий результат і не дублює операцію', async () => {
    const a = await account(app);
    const key = randomUUID();
    const first = await send(a.token, a.walletId, 'deposit', 25, key);
    const second = await send(a.token, a.walletId, 'deposit', 25, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect((await balanceOf(app, a)).balance).toBe('125.00');

    const w = randomUUID();
    await send(a.token, a.walletId, 'withdraw', 100, w);
    await send(a.token, a.walletId, 'withdraw', 100, w);
    expect((await balanceOf(app, a)).balance).toBe('25.00');
  });

  it('паралельні дублі з одним ключем виконуються рівно один раз', async () => {
    const a = await account(app);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => send(a.token, a.walletId, 'withdraw', 60, key)),
    );
    expect(results.map((r) => r.status)).toEqual(Array(10).fill(201));
    expect((await balanceOf(app, a)).balance).toBe('40.00');
  });

  it('той самий ключ з іншою сумою → 422', async () => {
    const a = await account(app);
    const key = randomUUID();
    await send(a.token, a.walletId, 'deposit', 10, key);
    const res = await send(a.token, a.walletId, 'deposit', 11, key);
    expect([res.status, res.body.code]).toEqual([422, 'IDEMPOTENCY_KEY_REUSED']);
    expect((await balanceOf(app, a)).balance).toBe('110.00');
  });

  it('ключ одного користувача не зачіпає іншого', async () => {
    const a = await account(app);
    const b = await account(app);
    const key = randomUUID();
    await send(a.token, a.walletId, 'deposit', 10, key).then((r) => expect(r.status).toBe(201));
    await send(b.token, b.walletId, 'deposit', 10, key).then((r) => expect(r.status).toBe(201));
    expect((await balanceOf(app, b)).balance).toBe('110.00');
  });

  it('відхиляє порожній або задовгий ключ', async () => {
    const a = await account(app);
    for (const key of ['', 'x'.repeat(129)]) {
      await send(a.token, a.walletId, 'deposit', 10, key).then((r) =>
        expect(r.status).toBe(400),
      );
    }
    expect((await balanceOf(app, a)).balance).toBe('100.00');
  });
});
