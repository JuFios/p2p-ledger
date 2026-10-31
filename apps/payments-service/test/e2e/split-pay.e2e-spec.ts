import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { FakeLedger } from './fake-ledger';
import {
  acceptShare,
  closeApp,
  createApp,
  createUser,
  getSplitBill,
  payShare,
  postSplitBill,
  postTransfer,
  waitForStatus,
} from './helpers';

type User = ReturnType<typeof createUser>;

describe('Split-рахунки: оплата частки (e2e)', () => {
  let app: INestApplication;
  let ledger: FakeLedger;

  beforeAll(async () => {
    ({ app, ledger } = await createApp());
  });

  afterAll(() => closeApp(app, ledger));

  afterEach(() => {
    ledger.down = false;
  });

  // Рахунок на 100 USD між учасниками порівну; частки одразу підтверджено.
  const acceptedBill = async (owner: User, members: User[]) => {
    const created = await postSplitBill(app, owner.token, {
      title: 'Оренда',
      totalAmount: 100,
      currency: 'USD',
      mode: 'EQUAL',
      participants: members.map((member) => ({ email: member.email })),
    }).expect(201);
    const shares: { id: string }[] = created.body.shares;
    for (const [index, member] of members.entries()) {
      await acceptShare(app, member.token, created.body.id, shares[index].id).expect(200);
    }
    return { billId: created.body.id as string, shares };
  };

  const view = async (user: User, billId: string) =>
    (await getSplitBill(app, user.token, billId).expect(200)).body;

  const transfersOf = (shareId: string) =>
    app
      .get(DataSource)
      .query(`SELECT id, status FROM transfers WHERE split_share_id = $1`, [shareId]);

  it('оплата часток: переказ на ініціатора, PAID у тій самій транзакції, PENDING → PARTIALLY_PAID → SETTLED', async () => {
    const owner = createUser(ledger, 'USD');
    const a = createUser(ledger, 'USD', 10000n);
    const b = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [a, b]);

    const first = await payShare(app, a.token, billId, shares[0].id, {
      fromWalletId: a.wallet.walletId,
    }).expect(202);
    expect(first.body).toMatchObject({
      status: 'PENDING',
      recipientEmail: owner.email,
      amount: '50.00',
      currency: 'USD',
    });
    expect((await view(a, billId)).shares[0].status).toBe('PAYING');

    await waitForStatus(app, a.token, first.body.id);
    // Переказ завершено — частка вже PAID, окремого очікування немає.
    let bill = await view(owner, billId);
    expect(bill.shares.map((s: { status: string }) => s.status)).toEqual(['PAID', 'ACCEPTED']);
    expect(bill.status).toBe('PARTIALLY_PAID');
    expect(a.wallet.available).toBe(5000n);
    expect(owner.wallet.available).toBe(5000n);

    const second = await payShare(app, b.token, billId, shares[1].id, {
      fromWalletId: b.wallet.walletId,
    }).expect(202);
    await waitForStatus(app, b.token, second.body.id);
    bill = await view(owner, billId);
    expect(bill.status).toBe('SETTLED');
    expect(owner.wallet.available).toBe(10000n);

    // Сплачену частку вдруге сплатити не можна.
    await payShare(app, a.token, billId, shares[0].id, {
      fromWalletId: a.wallet.walletId,
    }).expect(409);
  });

  it('оплата без accept → 409, переказ не створюється', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const created = await postSplitBill(app, owner.token, {
      title: 'Без підтвердження',
      totalAmount: 10,
      currency: 'USD',
      mode: 'EQUAL',
      participants: [{ email: member.email }],
    }).expect(201);
    const shareId = created.body.shares[0].id;
    const res = await payShare(app, member.token, created.body.id, shareId, {
      fromWalletId: member.wallet.walletId,
    }).expect(409);
    expect(res.body.code).toBe('INVALID_SHARE_STATUS');
    expect(await transfersOf(shareId)).toEqual([]);
    expect((await view(member, created.body.id)).shares[0].status).toBe('PENDING');
    expect(member.wallet.held).toBe(0n);
  });

  it('чужа частка, чужий рахунок, частка не з цього рахунку → 404', async () => {
    const owner = createUser(ledger);
    const a = createUser(ledger, 'USD', 10000n);
    const b = createUser(ledger, 'USD', 10000n);
    const stranger = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [a, b]);
    const other = await acceptedBill(owner, [a]);

    for (const user of [owner, b, stranger]) {
      await payShare(app, user.token, billId, shares[0].id, {
        fromWalletId: user.wallet.walletId,
      }).expect(404);
    }
    await payShare(app, a.token, other.billId, shares[0].id, {
      fromWalletId: a.wallet.walletId,
    }).expect(404);
    await payShare(app, a.token, billId, randomUUID(), {
      fromWalletId: a.wallet.walletId,
    }).expect(404);
    expect(await transfersOf(shares[0].id)).toEqual([]);
    expect((await view(a, billId)).shares[0].status).toBe('ACCEPTED');
  });

  it('гаманець: чужий чи неіснуючий → 404, іншої валюти → 400 CURRENCY_MISMATCH', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const victim = createUser(ledger, 'USD', 10000n);
    const eurWallet = ledger.addWallet(member.userId, 'EUR', 10000n);
    const { billId, shares } = await acceptedBill(owner, [member]);

    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: victim.wallet.walletId,
    }).expect(404);
    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: randomUUID(),
    }).expect(404);
    const mismatch = await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: eurWallet.walletId,
    }).expect(400);
    expect(mismatch.body.code).toBe('CURRENCY_MISMATCH');
    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: 'not-a-uuid',
    }).expect(400);
    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: member.wallet.walletId,
    }, null).expect(400);

    expect(await transfersOf(shares[0].id)).toEqual([]);
    expect((await view(member, billId)).shares[0].status).toBe('ACCEPTED');
    expect(victim.wallet).toMatchObject({ available: 10000n, held: 0n });
  });

  it('повторна оплата з тим самим ключем → один переказ; інше тіло з тим самим ключем → 422', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [member]);
    const key = randomUUID();
    const body = { fromWalletId: member.wallet.walletId };

    const first = await payShare(app, member.token, billId, shares[0].id, body, key).expect(202);
    const repeat = await payShare(app, member.token, billId, shares[0].id, body, key).expect(200);
    expect(repeat.body.id).toBe(first.body.id);
    await waitForStatus(app, member.token, first.body.id);
    // Повтор і після завершення віддає той самий переказ, а не 409.
    const late = await payShare(app, member.token, billId, shares[0].id, body, key).expect(200);
    expect(late.body.id).toBe(first.body.id);

    const other = ledger.addWallet(member.userId, 'USD', 10000n);
    await payShare(app, member.token, billId, shares[0].id, { fromWalletId: other.walletId }, key).expect(
      422,
    );
    expect(await transfersOf(shares[0].id)).toHaveLength(1);
    expect(member.wallet.available).toBe(0n);
  });

  it('ключ звичайного переказу не оплачує частку (і навпаки) → 422', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [member]);
    const key = randomUUID();
    // Звичайний переказ з тими самими гаманцем, отримувачем і сумою, що й у частки.
    await postTransfer(
      app,
      member.token,
      {
        fromWalletId: member.wallet.walletId,
        toWalletIdentifier: owner.email,
        amount: 100,
        currency: 'USD',
      },
      key,
    ).expect(202);
    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: member.wallet.walletId,
    }, key).expect(422);
    expect((await view(member, billId)).shares[0].status).toBe('ACCEPTED');

    const payKey = randomUUID();
    await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: member.wallet.walletId,
    }, payKey).expect(202);
    await postTransfer(
      app,
      member.token,
      {
        fromWalletId: member.wallet.walletId,
        toWalletIdentifier: owner.email,
        amount: 100,
        currency: 'USD',
      },
      payKey,
    ).expect(422);
  });

  it('20 паралельних оплат з одним ключем → один переказ', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [member]);
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        payShare(app, member.token, billId, shares[0].id, {
          fromWalletId: member.wallet.walletId,
        }, key),
      ),
    );
    expect(responses.map((r) => r.status).sort((x, y) => x - y)).toEqual([
      ...Array(19).fill(200),
      202,
    ]);
    expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
    expect(await transfersOf(shares[0].id)).toHaveLength(1);
  });

  it('паралельні оплати з різними ключами → один переказ, решта 409', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const { billId, shares } = await acceptedBill(owner, [member]);
    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        payShare(app, member.token, billId, shares[0].id, {
          fromWalletId: member.wallet.walletId,
        }),
      ),
    );
    expect(responses.map((r) => r.status).sort((x, y) => x - y)).toEqual([
      202,
      ...Array(9).fill(409),
    ]);
    const rows = await transfersOf(shares[0].id);
    expect(rows).toHaveLength(1);
    await waitForStatus(app, member.token, rows[0].id);
    // Списано рівно одну частку (100 USD / 1 учасник).
    expect(member.wallet.available).toBe(0n);
    expect(owner.wallet.available).toBe(10000n);
  });

  it('невдала оплата повертає частку в ACCEPTED, і її можна сплатити знову', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 500n);
    const { billId, shares } = await acceptedBill(owner, [member]);

    const failed = await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: member.wallet.walletId,
    }).expect(202);
    const done = await waitForStatus(app, member.token, failed.body.id);
    expect(done).toMatchObject({ status: 'FAILED', failureReason: 'INSUFFICIENT_FUNDS' });
    let bill = await view(member, billId);
    expect(bill.shares[0].status).toBe('ACCEPTED');
    expect(bill.status).toBe('PENDING');

    member.wallet.available = 20000n;
    const retry = await payShare(app, member.token, billId, shares[0].id, {
      fromWalletId: member.wallet.walletId,
    }).expect(202);
    expect(retry.body.id).not.toBe(failed.body.id);
    await waitForStatus(app, member.token, retry.body.id);
    bill = await view(member, billId);
    expect(bill.shares[0].status).toBe('PAID');
    expect(bill.status).toBe('SETTLED');
  });
});
