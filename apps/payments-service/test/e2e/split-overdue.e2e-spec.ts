import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { FakeLedger } from './fake-ledger';
import {
  acceptShare,
  closeApp,
  createApp,
  createUser,
  payShare,
  postSplitBill,
  waitForStatus,
} from './helpers';
import { SplitOverdueWorker } from '../../src/split-bills/split-overdue.service';

describe('Split-рахунки: прострочені частки (e2e)', () => {
  let app: INestApplication;
  let ledger: FakeLedger;
  let db: DataSource;
  let worker: SplitOverdueWorker;
  let reminderMs: number;
  const billIds: string[] = [];

  beforeAll(async () => {
    ({ app, ledger } = await createApp());
    db = app.get(DataSource);
    worker = app.get(SplitOverdueWorker);
    reminderMs = app.get(ConfigService).getOrThrow<number>('SPLIT_REMINDER_INTERVAL_MS');
  });

  // Прострочені рахунки не лишаємо в спільній БД: наступний запуск
  // знову нагадав би про них.
  afterAll(async () => {
    await db.query(`UPDATE split_bills SET due_at = NULL WHERE id = ANY($1)`, [billIds]);
    await closeApp(app, ledger);
  });

  const createBill = async (dueAt?: string) => {
    const owner = createUser(ledger);
    const member = createUser(ledger, 'USD', 10000n);
    const res = await postSplitBill(app, owner.token, {
      title: 'Нагадування',
      totalAmount: 10,
      currency: 'USD',
      mode: 'EQUAL',
      participants: [{ email: member.email }],
      ...(dueAt ? { dueAt } : {}),
    }).expect(201);
    billIds.push(res.body.id);
    return { owner, member, billId: res.body.id as string, shareId: res.body.shares[0].id as string };
  };

  const makeOverdue = (billId: string) =>
    db.query(`UPDATE split_bills SET due_at = now() - interval '1 hour' WHERE id = $1`, [billId]);

  const reminders = async (shareId: string) => {
    const rows: { user_ids: string[]; payload: { amount: string; shareId: string } }[] =
      await db.query(
        `SELECT user_ids, payload FROM outbox
         WHERE type = 'SplitShareOverdue' AND payload->>'shareId' = $1 ORDER BY id`,
        [shareId],
      );
    return rows;
  };

  it('прострочена частка: одне нагадування її власнику, далі не частіше ніж раз за інтервал', async () => {
    const { member, billId, shareId } = await createBill(
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    // Термін ще не настав.
    await worker.runOnce();
    expect(await reminders(shareId)).toHaveLength(0);

    await makeOverdue(billId);
    await worker.runOnce();
    const first = await reminders(shareId);
    expect(first).toHaveLength(1);
    expect(first[0].user_ids).toEqual([member.userId]);
    expect(first[0].payload.amount).toBe('10.00');

    // Той самий інтервал — повторного нагадування немає, навіть при паралельних тіках.
    await Promise.all([worker.runOnce(), worker.runOnce(), worker.runOnce()]);
    expect(await reminders(shareId)).toHaveLength(1);

    // Минув інтервал — нагадуємо знову, і теж один раз.
    await db.query(
      `UPDATE split_shares SET last_reminded_at = now() - make_interval(secs => $2::numeric / 1000 + 1)
       WHERE id = $1`,
      [shareId, reminderMs],
    );
    await Promise.all([worker.runOnce(), worker.runOnce()]);
    expect(await reminders(shareId)).toHaveLength(2);
  });

  it('без терміну, сплачені й ті, що сплачуються, не нагадуються; підтверджена нагадується', async () => {
    const noDue = await createBill();
    const paid = await createBill();
    const paying = await createBill();
    const accepted = await createBill();
    await acceptShare(app, accepted.member.token, accepted.billId, accepted.shareId).expect(200);
    await acceptShare(app, paid.member.token, paid.billId, paid.shareId).expect(200);
    const pay = await payShare(app, paid.member.token, paid.billId, paid.shareId, {
      fromWalletId: paid.member.wallet.walletId,
    }).expect(202);
    await waitForStatus(app, paid.member.token, pay.body.id);
    // Оплата триває: статус PAYING виставляємо напряму, щоб не гнатись за сагою.
    await db.query(`UPDATE split_shares SET status = 'PAYING' WHERE id = $1`, [paying.shareId]);

    for (const bill of [paid, paying, accepted]) await makeOverdue(bill.billId);
    await worker.runOnce();

    expect(await reminders(noDue.shareId)).toHaveLength(0);
    expect(await reminders(paid.shareId)).toHaveLength(0);
    expect(await reminders(paying.shareId)).toHaveLength(0);
    expect(await reminders(accepted.shareId)).toHaveLength(1);
  });
});
