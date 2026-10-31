import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createApp } from './helpers';
import {
  account,
  balanceOf,
  capture,
  freeze,
  internal,
  loginAdmin,
  placeHold,
  reconciliation,
  release,
  walletEvents,
} from './ledger-helpers';

// Холди під перекази через внутрішній API (так їх викликає сага payments).
describe('Holds (e2e)', () => {
  let app: INestApplication;
  let admin: string;

  beforeAll(async () => {
    app = await createApp();
    admin = await loginAdmin(app);
  });

  afterAll(async () => {
    await app.close();
  });

  const types = async (walletId: string) =>
    (await walletEvents(app, admin, walletId)).map((e) => e.type);

  it('hold під переказ пише TransferInitiated і HoldPlaced, кошти переходять у held', async () => {
    const a = await account(app);
    const { res, holdId } = await placeHold(app, a, '3000');
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ holdId, status: 'ACTIVE' });

    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '70.00',
      held: '30.00',
    });
    expect(await types(a.walletId)).toEqual([
      'WalletOpened',
      'MoneyDeposited',
      'TransferInitiated',
      'HoldPlaced',
    ]);
    await internal(app)
      .get(`/internal/holds/${holdId}`)
      .expect(200, { holdId, status: 'ACTIVE' });
  });

  it('release з причиною повертає кошти й пише HoldReleased + TransferFailed', async () => {
    const a = await account(app);
    const { holdId } = await placeHold(app, a, '3000');

    const res = await release(app, holdId, 'RECIPIENT_FROZEN');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ holdId, status: 'RELEASED' });

    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '100.00',
      held: '0.00',
    });
    const events = await walletEvents(app, admin, a.walletId);
    expect(events.slice(-2).map((e) => e.type)).toEqual([
      'HoldReleased',
      'TransferFailed',
    ]);
    expect(events[events.length - 1].payload).toMatchObject({
      transferId: holdId,
      reason: 'RECIPIENT_FROZEN',
    });
  });

  it('release без причини пише лише HoldReleased', async () => {
    const a = await account(app);
    const { holdId } = await placeHold(app, a, '1000');
    await release(app, holdId).then((r) => expect(r.status).toBe(200));
    expect((await types(a.walletId)).slice(-1)).toEqual(['HoldReleased']);
  });

  it('capture в одній валюті: обидва баланси й event-лог узгоджені', async () => {
    const a = await account(app);
    const b = await account(app, 'USD', 0);
    const { holdId } = await placeHold(app, a, '4000');

    const res = await capture(app, holdId, b, '4000');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ holdId, status: 'CAPTURED' });

    expect(await balanceOf(app, a)).toEqual({
      balance: '60.00',
      available: '60.00',
      held: '0.00',
    });
    expect(await balanceOf(app, b)).toEqual({
      balance: '40.00',
      available: '40.00',
      held: '0.00',
    });
    // Подія одна, у потоці відправника; отримувач бачить її за проводками.
    const fromLog = await walletEvents(app, admin, a.walletId);
    const toLog = await walletEvents(app, admin, b.walletId);
    const completed = fromLog[fromLog.length - 1];
    expect(completed.type).toBe('TransferCompleted');
    expect(toLog.map((e) => e.type)).toEqual(['WalletOpened', 'TransferCompleted']);
    expect(toLog[1].eventId).toBe(completed.eventId);
    await internal(app)
      .get(`/internal/holds/${holdId}`)
      .expect(200, { holdId, status: 'CAPTURED' });
  });

  it('міжвалютний capture USD → EUR проходить через клірингові рахунки', async () => {
    const a = await account(app);
    const b = await account(app, 'EUR', 0);
    const { holdId } = await placeHold(app, a, '5000');

    const res = await capture(app, holdId, b, '4600', {
      toCurrency: 'EUR',
      fxRate: 0.92,
    });
    expect(res.status).toBe(200);

    expect((await balanceOf(app, a)).balance).toBe('50.00');
    expect((await balanceOf(app, b)).balance).toBe('46.00');
    const events = await walletEvents(app, admin, b.walletId);
    expect(events[1].payload.postings).toEqual([
      expect.objectContaining({ account: `wallet:${a.walletId}:held`, currency: 'USD', direction: 'DEBIT', amountMinor: '5000' }),
      expect.objectContaining({ account: 'system:fx:USD', currency: 'USD', direction: 'CREDIT', amountMinor: '5000' }),
      expect.objectContaining({ account: 'system:fx:EUR', currency: 'EUR', direction: 'DEBIT', amountMinor: '4600' }),
      expect.objectContaining({ account: `wallet:${b.walletId}:available`, currency: 'EUR', direction: 'CREDIT', amountMinor: '4600' }),
    ]);
    const report = await reconciliation(app, admin);
    expect(report.body.perCurrency).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'USD', diff: '0.00' }),
        expect.objectContaining({ currency: 'EUR', diff: '0.00' }),
      ]),
    );
  });

  it('повтор з тим самим operationId не дублює операцію', async () => {
    const a = await account(app);
    const b = await account(app, 'USD', 0);
    const first = await placeHold(app, a, '3000');
    const again = await internal(app).post('/internal/holds', first.body);
    expect(again.status).toBe(201);
    expect(again.body).toEqual(first.res.body);
    expect((await balanceOf(app, a)).held).toBe('30.00');

    const captured = await capture(app, first.holdId, b, '3000');
    const recaptured = await capture(app, first.holdId, b, '3000');
    expect(recaptured.status).toBe(200);
    expect(recaptured.body).toEqual(captured.body);
    expect((await balanceOf(app, b)).balance).toBe('30.00');
    expect((await balanceOf(app, a)).balance).toBe('70.00');
    expect(
      (await types(a.walletId)).filter((t) => t === 'TransferCompleted'),
    ).toHaveLength(1);

    // Компенсація після успішного capture неможлива.
    const late = await release(app, first.holdId, 'TIMEOUT');
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('HOLD_NOT_ACTIVE');
  });

  it('повтор з іншим порядком полів дає той самий результат, а не 422', async () => {
    const a = await account(app);
    const b = await account(app, 'USD', 0);
    const reversed = (body: object) =>
      Object.fromEntries(Object.entries(body).reverse());
    const first = await placeHold(app, a, '3000');
    const again = await internal(app).post('/internal/holds', reversed(first.body));
    expect([again.status, again.body]).toEqual([201, first.res.body]);

    const body = {
      operationId: `transfer:${first.holdId}:capture`,
      toWalletId: b.walletId,
      toAmountMinor: '3000',
      toCurrency: 'USD',
      fxRate: 1,
    };
    const url = `/internal/holds/${first.holdId}/capture`;
    await internal(app).post(url, body).expect(200);
    await internal(app).post(url, reversed(body)).expect(200);
    expect((await balanceOf(app, b)).balance).toBe('30.00');
  });

  it('паралельні дублі однієї команди виконуються один раз', async () => {
    const a = await account(app);
    const transferId = randomUUID();
    const body = {
      operationId: `transfer:${transferId}:hold`,
      holdId: transferId,
      walletId: a.walletId,
      ownerId: a.userId,
      amountMinor: '2500',
      currency: 'USD',
      transferId,
    };
    const results = await Promise.all(
      Array.from({ length: 5 }, () => internal(app).post('/internal/holds', body)),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect((await balanceOf(app, a)).held).toBe('25.00');
  });

  it('той самий operationId з іншими параметрами → 422', async () => {
    const a = await account(app);
    const first = await placeHold(app, a, '1000');
    const res = await internal(app).post('/internal/holds', {
      ...first.body,
      amountMinor: '2000',
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await balanceOf(app, a)).held).toBe('10.00');
  });

  it('capture на заморожений гаманець отримувача → RECIPIENT_FROZEN, held лишається, release повертає кошти', async () => {
    const a = await account(app);
    const b = await account(app, 'USD', 0);
    const { holdId } = await placeHold(app, a, '3000');
    await freeze(app, admin, b.walletId).then((r) => expect(r.status).toBe(200));

    const res = await capture(app, holdId, b, '3000');
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RECIPIENT_FROZEN');
    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '70.00',
      held: '30.00',
    });
    expect((await balanceOf(app, b)).balance).toBe('0.00');

    await release(app, holdId, 'RECIPIENT_FROZEN').then((r) =>
      expect(r.status).toBe(200),
    );
    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '100.00',
      held: '0.00',
    });
  });

  it('capture із замороженого гаманця відправника → WALLET_FROZEN, held лишається', async () => {
    const a = await account(app);
    const b = await account(app, 'USD', 0);
    const { holdId } = await placeHold(app, a, '3000');
    await freeze(app, admin, a.walletId).then((r) => expect(r.status).toBe(200));

    const res = await capture(app, holdId, b, '3000');
    expect([res.status, res.body.code]).toEqual([409, 'WALLET_FROZEN']);
    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '70.00',
      held: '30.00',
    });
    expect((await balanceOf(app, b)).balance).toBe('0.00');
    // Компенсація на замороженому гаманці проходить.
    await release(app, holdId, 'WALLET_FROZEN').then((r) =>
      expect(r.status).toBe(200),
    );
    expect((await balanceOf(app, a)).available).toBe('100.00');
  });

  it('міжвалютна сума зарахування має відповідати курсу', async () => {
    const a = await account(app);
    const b = await account(app, 'EUR', 0);
    const { holdId } = await placeHold(app, a, '5000');

    const res = await capture(app, holdId, b, '999999999', {
      toCurrency: 'EUR',
      fxRate: 0.92,
    });
    expect(res.status).toBe(400);
    expect((await balanceOf(app, b)).balance).toBe('0.00');
    expect((await balanceOf(app, a)).held).toBe('50.00');

    // Розбіжність округлення в одну мінорну одиницю допустима.
    await capture(app, holdId, b, '4601', { toCurrency: 'EUR', fxRate: 0.92 }).then(
      (r) => expect(r.status).toBe(200),
    );
    expect((await balanceOf(app, b)).balance).toBe('46.01');
  });

  it('конкурентні холди не дають овердрафту', async () => {
    const a = await account(app);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => placeHold(app, a, '2000')),
    );
    const statuses = results.map(({ res }) => res.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    const refused = results.filter(({ res }) => res.status !== 201);
    expect(refused).toHaveLength(5);
    for (const { res } of refused) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INSUFFICIENT_FUNDS');
    }
    expect(await balanceOf(app, a)).toEqual({
      balance: '100.00',
      available: '0.00',
      held: '100.00',
    });
  });

  it('відмови hold мають коди помилок', async () => {
    const a = await account(app);
    const other = await account(app);
    const eur = await account(app, 'EUR');
    const cases: [Record<string, unknown>, number, string][] = [
      [{ amountMinor: '10001' }, 409, 'INSUFFICIENT_FUNDS'],
      [{ ownerId: other.userId }, 409, 'OWNER_MISMATCH'],
      [{ currency: 'EUR' }, 409, 'CURRENCY_MISMATCH'],
      [{ walletId: randomUUID() }, 404, 'NOT_FOUND'],
    ];
    for (const [overrides, status, code] of cases) {
      const { res } = await placeHold(app, a, '1000', overrides);
      expect([res.status, res.body.code]).toEqual([status, code]);
    }
    await freeze(app, admin, eur.walletId);
    const { res } = await placeHold(app, eur, '1000', { currency: 'EUR' });
    expect([res.status, res.body.code]).toEqual([409, 'WALLET_FROZEN']);
    expect((await balanceOf(app, a)).held).toBe('0.00');
  });

  it('відхиляє невалідні команди й невідомі холди', async () => {
    const a = await account(app);
    const { res } = await placeHold(app, a, '10.5');
    expect(res.status).toBe(400);
    const missing = randomUUID();
    const notFound = await release(app, missing);
    expect([notFound.status, notFound.body.code]).toEqual([404, 'NOT_FOUND']);
    await internal(app).get(`/internal/holds/${missing}`).expect(404);
  });
});
