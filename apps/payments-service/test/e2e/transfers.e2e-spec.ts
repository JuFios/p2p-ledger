import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeLedger } from './fake-ledger';
import {
  closeApp,
  createApp,
  createUser,
  postTransfer,
  waitForStatus,
} from './helpers';

describe('Сага переказу (e2e)', () => {
  let app: INestApplication;
  let ledger: FakeLedger;

  beforeAll(async () => {
    ({ app, ledger } = await createApp());
  });

  afterAll(() => closeApp(app, ledger));

  afterEach(() => {
    ledger.down = false;
    ledger.downPath = null;
  });

  const statusEvents = async (transferId: string) => {
    const rows: { payload: { status: string; step: string } }[] = await app
      .get(DataSource)
      .query(
        `SELECT payload FROM outbox
         WHERE type = 'TransferStatusChanged' AND payload->>'transferId' = $1
         ORDER BY id`,
        [transferId],
      );
    return rows.map((row) => `${row.payload.status}/${row.payload.step}`);
  };

  it('переказ в одній валюті: 202, далі COMPLETED, гроші в отримувача', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 25.5,
      currency: 'USD',
    }).expect(202);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      step: 'RISK_CHECK',
      amount: '25.50',
      toCurrency: 'USD',
    });

    const done = await waitForStatus(app, sender.token, res.body.id);
    expect(done).toMatchObject({ status: 'COMPLETED', step: 'DONE', toAmount: '25.50' });
    expect(sender.wallet).toMatchObject({ available: 7450n, held: 0n });
    expect(recipient.wallet.available).toBe(2550n);
    // Отримувач бачить переказ після зарахування.
    await waitForStatus(app, recipient.token, res.body.id);
    expect(await statusEvents(res.body.id)).toEqual([
      'PENDING/RISK_CHECK',
      'PROCESSING/RESOLVE_RECIPIENT',
      'PROCESSING/FX_QUOTE',
      'PROCESSING/HOLD',
      'PROCESSING/CONFIRM',
      'PROCESSING/CAPTURE',
      'COMPLETED/DONE',
    ]);
  });

  it('міжвалютний переказ: гаманець отримувача створюється, сума за курсом', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'UAH');
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 10,
      currency: 'USD',
      toCurrency: 'EUR',
    }).expect(202);
    const done = await waitForStatus(app, sender.token, res.body.id);
    expect(done).toMatchObject({
      status: 'COMPLETED',
      fxRate: '0.92000000',
      toAmount: '9.20',
      toCurrency: 'EUR',
    });
    expect(ledger.walletOf(recipient.userId, 'EUR')?.available).toBe(920n);
    expect(sender.wallet.available).toBe(9000n);
  });

  // FakeLedger відхиляє зарахування, що не збігається з курсом (±1 мінорна
  // одиниця), як справжній ledger: сума від payments має його проходити.
  it.each([
    ['USD', 'UAH', 10, '415.00', 41500n],
    ['UAH', 'USD', 1000, '24.09', 2409n],
    ['EUR', 'UAH', 10, '451.08', 45108n],
  ])('міжвалютний переказ %s → %s проходить правило курсу ledger', async (from, to, amount, toAmount, credited) => {
    const sender = createUser(ledger, from, 10_000_00n);
    const recipient = createUser(ledger, to);
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount,
      currency: from,
      toCurrency: to,
    }).expect(202);
    const done = await waitForStatus(app, sender.token, res.body.id);
    expect(done).toMatchObject({ status: 'COMPLETED', toAmount, toCurrency: to });
    expect(recipient.wallet.available).toBe(credited);
  });

  it('відправника заморожено після холду: capture відхилено, холд знято, кошти повернулись', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const placeHold = ledger['place'].bind(ledger);
    ledger['place'] = (body: Record<string, string>) => {
      const result = placeHold(body);
      sender.wallet.frozen = true;
      return result;
    };
    try {
      const res = await postTransfer(app, sender.token, {
        fromWalletId: sender.wallet.walletId,
        toWalletIdentifier: recipient.email,
        amount: 40,
        currency: 'USD',
      }).expect(202);
      const done = await waitForStatus(app, sender.token, res.body.id);
      expect(done).toMatchObject({
        status: 'FAILED',
        step: 'RELEASE_HOLD',
        failureReason: 'WALLET_FROZEN',
      });
      expect(sender.wallet).toMatchObject({ available: 10000n, held: 0n });
      expect(recipient.wallet.available).toBe(0n);
    } finally {
      ledger['place'] = placeHold;
      sender.wallet.frozen = false;
    }
  });

  it('недостатньо коштів: FAILED на холді, баланс не змінився', async () => {
    const sender = createUser(ledger, 'USD', 500n);
    const recipient = createUser(ledger, 'USD');
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 10,
      currency: 'USD',
    }).expect(202);
    const done = await waitForStatus(app, sender.token, res.body.id);
    expect(done).toMatchObject({
      status: 'FAILED',
      step: 'HOLD',
      failureReason: 'INSUFFICIENT_FUNDS',
    });
    expect(sender.wallet).toMatchObject({ available: 500n, held: 0n });
  });

  it('отримувача заморожено після холду: холд знято, кошти повернулись', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    // Заморожуємо отримувача рівно в момент, коли холд поставлено.
    const placeHold = ledger['place'].bind(ledger);
    ledger['place'] = (body: Record<string, string>) => {
      const result = placeHold(body);
      recipient.wallet.frozen = true;
      return result;
    };
    try {
      const res = await postTransfer(app, sender.token, {
        fromWalletId: sender.wallet.walletId,
        toWalletIdentifier: recipient.email,
        amount: 40,
        currency: 'USD',
      }).expect(202);
      const done = await waitForStatus(app, sender.token, res.body.id);
      expect(done).toMatchObject({
        status: 'FAILED',
        step: 'RELEASE_HOLD',
        failureReason: 'RECIPIENT_FROZEN',
      });
      expect(sender.wallet).toMatchObject({ available: 10000n, held: 0n });
      expect(recipient.wallet.available).toBe(0n);
      expect(ledger.holds.get(res.body.id)?.status).toBe('RELEASED');
      expect(await statusEvents(res.body.id)).toEqual([
        'PENDING/RISK_CHECK',
        'PROCESSING/RESOLVE_RECIPIENT',
        'PROCESSING/FX_QUOTE',
        'PROCESSING/HOLD',
        'PROCESSING/CONFIRM',
        'COMPENSATING/RELEASE_HOLD',
        'FAILED/RELEASE_HOLD',
      ]);
    } finally {
      ledger['place'] = placeHold;
    }
  });

  it('отримувача заморожено після CONFIRM: capture відхилено, холд знято', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    // CONFIRM ще бачить незаморожений гаманець, заморозка встигає до CAPTURE.
    const route = ledger['route'].bind(ledger);
    ledger['route'] = (method: string, path: string, body: Record<string, string>) => {
      const result = route(method, path, body);
      if (method === 'GET' && path === `/internal/wallets/${recipient.wallet.walletId}`)
        recipient.wallet.frozen = true;
      return result;
    };
    try {
      const res = await postTransfer(app, sender.token, {
        fromWalletId: sender.wallet.walletId,
        toWalletIdentifier: recipient.email,
        amount: 40,
        currency: 'USD',
      }).expect(202);
      const done = await waitForStatus(app, sender.token, res.body.id);
      expect(done).toMatchObject({
        status: 'FAILED',
        step: 'RELEASE_HOLD',
        failureReason: 'RECIPIENT_FROZEN',
      });
      expect(sender.wallet).toMatchObject({ available: 10000n, held: 0n });
      expect(recipient.wallet.available).toBe(0n);
      expect(ledger.holds.get(res.body.id)?.status).toBe('RELEASED');
      expect(await statusEvents(res.body.id)).toEqual([
        'PENDING/RISK_CHECK',
        'PROCESSING/RESOLVE_RECIPIENT',
        'PROCESSING/FX_QUOTE',
        'PROCESSING/HOLD',
        'PROCESSING/CONFIRM',
        'PROCESSING/CAPTURE',
        'COMPENSATING/RELEASE_HOLD',
        'FAILED/RELEASE_HOLD',
      ]);
    } finally {
      ledger['route'] = route;
    }
  });

  it('ledger недоступний: AWAITING_RETRY, після відновлення переказ завершується', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    ledger.down = true;
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 1,
      currency: 'USD',
    }).expect(202);
    const waiting = await waitForStatus(app, sender.token, res.body.id, [
      'AWAITING_RETRY',
    ]);
    expect(waiting.step).toBe('RESOLVE_RECIPIENT');
    ledger.down = false;
    const done = await waitForStatus(app, sender.token, res.body.id);
    expect(done.status).toBe('COMPLETED');
    expect(recipient.wallet.available).toBe(100n);
  });

  it('чужий гаманець відправника: ledger відмовляє (OWNER_MISMATCH), гроші на місці', async () => {
    const attacker = createUser(ledger, 'USD');
    const victim = createUser(ledger, 'USD', 10000n);
    const res = await postTransfer(app, attacker.token, {
      fromWalletId: victim.wallet.walletId,
      toWalletIdentifier: victim.email,
      amount: 50,
      currency: 'USD',
    }).expect(202);
    const done = await waitForStatus(app, attacker.token, res.body.id);
    expect(done).toMatchObject({ status: 'FAILED', failureReason: 'OWNER_MISMATCH' });
    expect(victim.wallet).toMatchObject({ available: 10000n, held: 0n });
  });

  it('чужий переказ: GET /transfers/:id → 404, у списку його немає', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const stranger = createUser(ledger, 'USD');
    const res = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 1,
      currency: 'USD',
    }).expect(202);
    await request(app.getHttpServer())
      .get(`/transfers/${res.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(404);
    const list = await request(app.getHttpServer())
      .get('/transfers')
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(200);
    expect(list.body).toEqual([]);
    const own = await request(app.getHttpServer())
      .get('/transfers?limit=5')
      .set('Authorization', `Bearer ${sender.token}`)
      .expect(200);
    expect(own.body.map((t: { id: string }) => t.id)).toContain(res.body.id);
  });

  it('отримувач бачить лише завершені перекази: невдалі й незавершені — 404, у списку їх немає', async () => {
    const sender = createUser(ledger, 'USD', 500n);
    const recipient = createUser(ledger, 'USD');
    // RESOLVE_RECIPIENT уже проставив отримувача, а холд відхилено: переказ FAILED.
    const failed = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 10,
      currency: 'USD',
    }).expect(202);
    await waitForStatus(app, sender.token, failed.body.id);
    // Переказ, що ще виконується: отримувача вже визначено (RESOLVE_RECIPIENT),
    // а холд недоступний — сага чекає на HOLD.
    ledger.downPath = /^\/internal\/holds$/;
    const pending = await postTransfer(app, sender.token, {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 1,
      currency: 'USD',
    }).expect(202);
    await waitForStatus(app, sender.token, pending.body.id, ['AWAITING_RETRY']);
    const [row] = await app
      .get(DataSource)
      .query('SELECT recipient_user_id, step FROM transfers WHERE id = $1', [
        pending.body.id,
      ]);
    expect(row).toEqual({ recipient_user_id: recipient.userId, step: 'HOLD' });

    const get = (id: string) =>
      request(app.getHttpServer())
        .get(`/transfers/${id}`)
        .set('Authorization', `Bearer ${recipient.token}`);
    await get(failed.body.id).expect(404);
    const list = await request(app.getHttpServer())
      .get('/transfers')
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    await get(pending.body.id).expect(404);
    const ids = list.body.map((t: { id: string }) => t.id);
    expect(ids).not.toContain(failed.body.id);
    expect(ids).not.toContain(pending.body.id);
    ledger.downPath = null;

    // Відправник бачить усе; після зарахування переказ з'являється й в отримувача.
    await waitForStatus(app, sender.token, pending.body.id);
    const done = await get(pending.body.id).expect(200);
    expect(done.body.status).toBe('COMPLETED');
    const after = await request(app.getHttpServer())
      .get('/transfers')
      .set('Authorization', `Bearer ${recipient.token}`)
      .expect(200);
    expect(after.body.map((t: { id: string }) => t.id)).toEqual([pending.body.id]);
  });

  it('без JWT — 401; некоректне тіло — 400', async () => {
    await request(app.getHttpServer()).post('/transfers').send({}).expect(401);
    await request(app.getHttpServer()).get(`/transfers/${randomUUID()}`).expect(401);
    const sender = createUser(ledger, 'USD', 10000n);
    for (const body of [
      { amount: 1, currency: 'USD', toWalletIdentifier: 'a@b.c', fromWalletId: 'x' },
      { amount: 1.001, currency: 'USD', toWalletIdentifier: 'a@b.c', fromWalletId: sender.wallet.walletId },
      { amount: 1, currency: 'GBP', toWalletIdentifier: 'a@b.c', fromWalletId: sender.wallet.walletId },
      { amount: 1, currency: 'USD', toWalletIdentifier: 'not-an-email', fromWalletId: sender.wallet.walletId },
    ]) {
      await postTransfer(app, sender.token, body).expect(400);
    }
    await request(app.getHttpServer())
      .get('/transfers/not-a-uuid')
      .set('Authorization', `Bearer ${sender.token}`)
      .expect(400);
  });
});
