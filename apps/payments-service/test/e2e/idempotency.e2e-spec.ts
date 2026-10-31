import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { FakeLedger } from './fake-ledger';
import { closeApp, createApp, createUser, postTransfer, waitForStatus } from './helpers';

describe('Idempotency-Key на POST /transfers (e2e)', () => {
  let app: INestApplication;
  let ledger: FakeLedger;

  beforeAll(async () => {
    ({ app, ledger } = await createApp());
  });

  afterAll(() => closeApp(app, ledger));

  const countByKey = async (key: string) => {
    const [{ count }] = await app
      .get(DataSource)
      .query('SELECT count(*)::int AS count FROM transfers WHERE idempotency_key = $1', [key]);
    return count;
  };

  it('20 паралельних запитів з одним ключем → рівно один переказ і одне списання', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const key = randomUUID();
    const body = {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 10,
      currency: 'USD',
    };
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => postTransfer(app, sender.token, body, key)),
    );
    const statuses = responses.map((res) => res.status).sort();
    expect(statuses.filter((s) => s === 202)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(19);
    expect(new Set(responses.map((res) => res.body.id)).size).toBe(1);
    expect(await countByKey(key)).toBe(1);

    await waitForStatus(app, sender.token, responses[0].body.id);
    expect(sender.wallet.available).toBe(9000n);
    expect(recipient.wallet.available).toBe(1000n);
  });

  it('повтор після завершення повертає той самий переказ (200)', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const key = randomUUID();
    const body = {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 3,
      currency: 'USD',
    };
    const first = await postTransfer(app, sender.token, body, key).expect(202);
    await waitForStatus(app, sender.token, first.body.id);
    // Те саме тіло з іншим порядком полів і сумою 3.00 — той самий запит.
    const again = await postTransfer(
      app,
      sender.token,
      { currency: 'USD', amount: 3.0, toWalletIdentifier: recipient.email, fromWalletId: sender.wallet.walletId },
      key,
    ).expect(200);
    expect(again.body).toMatchObject({ id: first.body.id, status: 'COMPLETED' });
    expect(sender.wallet.available).toBe(9700n);
  });

  it('той самий ключ з іншим тілом → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    const sender = createUser(ledger, 'USD', 10000n);
    const recipient = createUser(ledger, 'USD');
    const key = randomUUID();
    const body = {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: recipient.email,
      amount: 1,
      currency: 'USD',
    };
    await postTransfer(app, sender.token, body, key).expect(202);
    const res = await postTransfer(app, sender.token, { ...body, amount: 2 }, key).expect(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await countByKey(key)).toBe(1);
  });

  it('ключ належить відправнику: інший користувач з тим самим ключем створює свій переказ', async () => {
    const key = randomUUID();
    const recipient = createUser(ledger, 'USD');
    for (const sender of [createUser(ledger, 'USD', 100n), createUser(ledger, 'USD', 100n)]) {
      await postTransfer(
        app,
        sender.token,
        { fromWalletId: sender.wallet.walletId, toWalletIdentifier: recipient.email, amount: 1, currency: 'USD' },
        key,
      ).expect(202);
    }
    expect(await countByKey(key)).toBe(2);
  });

  it('без Idempotency-Key або з задовгим ключем → 400', async () => {
    const sender = createUser(ledger, 'USD', 100n);
    const body = {
      fromWalletId: sender.wallet.walletId,
      toWalletIdentifier: 'someone@example.com',
      amount: 1,
      currency: 'USD',
    };
    await postTransfer(app, sender.token, body, null).expect(400);
    await postTransfer(app, sender.token, body, 'k'.repeat(129)).expect(400);
  });
});
