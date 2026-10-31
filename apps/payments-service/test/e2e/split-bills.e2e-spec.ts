import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { FakeLedger } from './fake-ledger';
import {
  acceptShare,
  closeApp,
  createApp,
  createUser,
  getSplitBill,
  postSplitBill,
  tokenFor,
} from './helpers';

describe('Split-рахунки: створення, перегляд, підтвердження (e2e)', () => {
  let app: INestApplication;
  let ledger: FakeLedger;

  beforeAll(async () => {
    ({ app, ledger } = await createApp());
  });

  afterAll(() => closeApp(app, ledger));

  afterEach(() => {
    ledger.down = false;
  });

  const bill = (overrides: Record<string, unknown>) => ({
    title: 'Вечеря',
    totalAmount: 100,
    currency: 'USD',
    mode: 'EQUAL',
    ...overrides,
  });

  it('порівну: залишок копійок першому учаснику, статус PENDING, учасники отримують подію', async () => {
    const owner = createUser(ledger);
    const [a, b, c] = [createUser(ledger), createUser(ledger), createUser(ledger)];
    const res = await postSplitBill(
      app,
      owner.token,
      bill({ participants: [a, b, c].map((p) => ({ email: p.email })) }),
    ).expect(201);
    expect(res.body).toMatchObject({
      title: 'Вечеря',
      creatorEmail: owner.email,
      totalAmount: '100.00',
      currency: 'USD',
      mode: 'EQUAL',
      status: 'PENDING',
    });
    expect(
      res.body.shares.map((s: { participantEmail: string; amount: string; status: string }) => [
        s.participantEmail,
        s.amount,
        s.status,
      ]),
    ).toEqual([
      [a.email, '33.34', 'PENDING'],
      [b.email, '33.33', 'PENDING'],
      [c.email, '33.33', 'PENDING'],
    ]);

    const events: { user_ids: string[]; payload: { billId: string } }[] = await app
      .get(DataSource)
      .query(`SELECT user_ids, payload FROM outbox WHERE type = 'SplitBillCreated' AND payload->>'billId' = $1`, [
        res.body.id,
      ]);
    expect(events).toHaveLength(1);
    expect([...events[0].user_ids].sort()).toEqual([a.userId, b.userId, c.userId].sort());
  });

  it('CUSTOM: суми задає ініціатор; сума часток ≠ загальній → 400', async () => {
    const owner = createUser(ledger);
    const [a, b] = [createUser(ledger), createUser(ledger)];
    const ok = await postSplitBill(
      app,
      owner.token,
      bill({
        mode: 'CUSTOM',
        totalAmount: 50,
        participants: [
          { email: a.email, amount: 20.5 },
          { email: b.email, amount: 29.5 },
        ],
      }),
    ).expect(201);
    expect(ok.body.shares.map((s: { amount: string }) => s.amount)).toEqual(['20.50', '29.50']);

    const bad = await postSplitBill(
      app,
      owner.token,
      bill({
        mode: 'CUSTOM',
        totalAmount: 50,
        participants: [
          { email: a.email, amount: 20.5 },
          { email: b.email, amount: 29.51 },
        ],
      }),
    ).expect(400);
    expect(bad.body.code).toBe('SHARES_SUM_MISMATCH');
  });

  it('відхиляє некоректні рахунки', async () => {
    const owner = createUser(ledger);
    const a = createUser(ledger);
    const b = createUser(ledger);
    const cases: [Record<string, unknown>, string | undefined][] = [
      [{ participants: [{ email: owner.email }] }, 'SELF_PARTICIPANT'],
      [{ participants: [{ email: 'nobody@example.com' }] }, 'PARTICIPANT_NOT_FOUND'],
      [{ participants: [{ email: a.email }, { email: a.email }] }, 'DUPLICATE_PARTICIPANT'],
      [{ participants: [{ email: a.email, amount: 10 }] }, 'AMOUNT_NOT_ALLOWED'],
      [{ mode: 'CUSTOM', participants: [{ email: a.email }] }, 'AMOUNT_REQUIRED'],
      [{ totalAmount: 0.01, participants: [{ email: a.email }, { email: b.email }] }, 'SHARE_TOO_SMALL'],
      [{ dueAt: '2020-01-01T00:00:00Z', participants: [{ email: a.email }] }, 'DUE_DATE_IN_PAST'],
      [{ dueAt: '2099-02-31T00:00:00Z', participants: [{ email: a.email }] }, undefined],
      [{ dueAt: 'tomorrow', participants: [{ email: a.email }] }, undefined],
      // Коректні для ISO 8601, але не розбираються в дату (тижневий, порядковий, базовий формат).
      [{ dueAt: '2099-W45', participants: [{ email: a.email }] }, 'INVALID_DUE_DATE'],
      [{ dueAt: '2099-W45-3', participants: [{ email: a.email }] }, 'INVALID_DUE_DATE'],
      [{ dueAt: '2099-100', participants: [{ email: a.email }] }, 'INVALID_DUE_DATE'],
      [{ dueAt: '20991105', participants: [{ email: a.email }] }, 'INVALID_DUE_DATE'],
      [{ participants: [] }, undefined],
      [{ participants: [{ email: 'not-an-email' }] }, undefined],
      [{ currency: 'GBP', participants: [{ email: a.email }] }, undefined],
      [{ totalAmount: 1.001, participants: [{ email: a.email }] }, undefined],
      [{ title: '   ', participants: [{ email: a.email }] }, undefined],
      [{ mode: 'RANDOM', participants: [{ email: a.email }] }, undefined],
    ];
    for (const [overrides, code] of cases) {
      const res = await postSplitBill(app, owner.token, bill(overrides)).expect(400);
      if (code) expect(res.body.code).toBe(code);
    }
  });

  it('частка понад ліміт переказу або чорний список → 400, рахунок не створено', async () => {
    const owner = createUser(ledger);
    const a = createUser(ledger);
    const blockedUser = ledger.addUser('blocked@example.com');
    const blocked = { ...blockedUser, token: tokenFor(blockedUser) };
    const created = () =>
      app
        .get(DataSource)
        .query(`SELECT count(*)::int AS n FROM split_bills WHERE creator_user_id = ANY($1)`, [
          [owner.userId, blocked.userId],
        ]);

    // Частка 50 000 / 1 > TRANSFER_MAX_AMOUNT (10 000): оплата завжди б завершувалась відмовою.
    const tooBig = await postSplitBill(
      app,
      owner.token,
      bill({ totalAmount: 50000, participants: [{ email: a.email }] }),
    ).expect(400);
    expect(tooBig.body.code).toBe('SHARE_LIMIT_EXCEEDED');
    // Рівно на межі — можна.
    await postSplitBill(
      app,
      owner.token,
      bill({ totalAmount: 10000, participants: [{ email: a.email }] }),
    ).expect(201);
    // CUSTOM: ліміт діє на кожну частку окремо.
    const b = createUser(ledger);
    await postSplitBill(
      app,
      owner.token,
      bill({
        mode: 'CUSTOM',
        totalAmount: 20000,
        participants: [
          { email: a.email, amount: 10001 },
          { email: b.email, amount: 9999 },
        ],
      }),
    ).expect(400);

    const blockedParticipant = await postSplitBill(
      app,
      owner.token,
      bill({ participants: [{ email: blocked.email }] }),
    ).expect(400);
    expect(blockedParticipant.body.code).toBe('BLOCKED_PARTICIPANT');
    const blockedCreator = await postSplitBill(
      app,
      blocked.token,
      bill({ participants: [{ email: a.email }] }),
    ).expect(400);
    expect(blockedCreator.body.code).toBe('BLOCKED_PARTICIPANT');
    expect((await created())[0].n).toBe(1);
  });

  describe('Idempotency-Key (необов\'язковий)', () => {
    const rows = (ownerId: string) =>
      app.get(DataSource).query(
        `SELECT
           (SELECT count(*)::int FROM split_bills WHERE creator_user_id::text = $1) AS bills,
           (SELECT count(*)::int FROM outbox
             WHERE type = 'SplitBillCreated' AND payload->>'creatorUserId' = $1) AS events`,
        [ownerId],
      );

    it('повтор з тим самим ключем → 200 і той самий рахунок, без дубліка й другої події', async () => {
      const owner = createUser(ledger);
      const a = createUser(ledger);
      const key = randomUUID();
      const body = bill({ participants: [{ email: a.email }] });
      const first = await postSplitBill(app, owner.token, body, key).expect(201);
      const repeat = await postSplitBill(app, owner.token, body, key).expect(200);
      expect(repeat.body.id).toBe(first.body.id);
      expect((await rows(owner.userId))[0]).toEqual({ bills: 1, events: 1 });
    });

    it('20 паралельних запитів з одним ключем → один рахунок', async () => {
      const owner = createUser(ledger);
      const a = createUser(ledger);
      const key = randomUUID();
      const body = bill({ participants: [{ email: a.email }] });
      const responses = await Promise.all(
        Array.from({ length: 20 }, () => postSplitBill(app, owner.token, body, key)),
      );
      expect(responses.map((r) => r.status).sort((x, y) => x - y)).toEqual([
        ...Array(19).fill(200),
        201,
      ]);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect((await rows(owner.userId))[0]).toEqual({ bills: 1, events: 1 });
    });

    it('той самий ключ з іншим тілом → 422; ключ іншого користувача незалежний', async () => {
      const owner = createUser(ledger);
      const other = createUser(ledger);
      const a = createUser(ledger);
      const key = randomUUID();
      await postSplitBill(app, owner.token, bill({ participants: [{ email: a.email }] }), key).expect(201);
      const reused = await postSplitBill(
        app,
        owner.token,
        bill({ totalAmount: 99, participants: [{ email: a.email }] }),
        key,
      ).expect(422);
      expect(reused.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await postSplitBill(app, other.token, bill({ participants: [{ email: a.email }] }), key).expect(201);
    });

    it('повтор віддає збережений рахунок, навіть якщо ledger лежить чи термін уже минув', async () => {
      const owner = createUser(ledger);
      const a = createUser(ledger);
      const key = randomUUID();
      const body = bill({
        participants: [{ email: a.email }],
        dueAt: new Date(Date.now() + 60_000).toISOString(),
      });
      const first = await postSplitBill(app, owner.token, body, key).expect(201);
      // «Через дві хвилини»: термін з тіла запиту вже минув (токен ще чинний).
      const now = Date.now();
      const clock = jest.spyOn(Date, 'now').mockReturnValue(now + 120_000);
      try {
        ledger.down = true;
        // Той самий запит тепер не пройшов би перевірку «dueAt у майбутньому».
        const repeat = await postSplitBill(app, owner.token, body, key).expect(200);
        expect(repeat.body.id).toBe(first.body.id);
      } finally {
        clock.mockRestore();
        // Рахунок з терміном не лишаємо в спільній БД: інакше він прострочиться.
        await app
          .get(DataSource)
          .query('UPDATE split_bills SET due_at = NULL WHERE id = $1', [first.body.id]);
      }
    });

    it('без ключа запити незалежні: два рахунки', async () => {
      const owner = createUser(ledger);
      const a = createUser(ledger);
      const body = bill({ participants: [{ email: a.email }] });
      await postSplitBill(app, owner.token, body).expect(201);
      await postSplitBill(app, owner.token, body).expect(201);
      expect((await rows(owner.userId))[0].bills).toBe(2);
    });

    it('некоректний ключ → 400', async () => {
      const owner = createUser(ledger);
      const a = createUser(ledger);
      await postSplitBill(app, owner.token, bill({ participants: [{ email: a.email }] }), 'x'.repeat(129)).expect(
        400,
      );
    });
  });

  it('ledger недоступний → 503, рахунок не створено', async () => {
    const owner = createUser(ledger);
    const a = createUser(ledger);
    ledger.down = true;
    await postSplitBill(app, owner.token, bill({ participants: [{ email: a.email }] })).expect(503);
    const count = await app
      .get(DataSource)
      .query(`SELECT count(*)::int AS n FROM split_bills WHERE creator_user_id = $1`, [owner.userId]);
    expect(count[0].n).toBe(0);
  });

  it('рахунок бачать ініціатор і учасники; стороннім — 404, у списку його немає', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger);
    const stranger = createUser(ledger);
    const created = await postSplitBill(
      app,
      owner.token,
      bill({ participants: [{ email: member.email }] }),
    ).expect(201);

    for (const user of [owner, member]) {
      const res = await getSplitBill(app, user.token, created.body.id).expect(200);
      expect(res.body.id).toBe(created.body.id);
      const list = await request(app.getHttpServer())
        .get('/split-bills')
        .set('Authorization', `Bearer ${user.token}`)
        .expect(200);
      expect(list.body.map((b: { id: string }) => b.id)).toContain(created.body.id);
    }
    await getSplitBill(app, stranger.token, created.body.id).expect(404);
    const list = await request(app.getHttpServer())
      .get('/split-bills')
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(200);
    expect(list.body).toEqual([]);
    await getSplitBill(app, owner.token, randomUUID()).expect(404);
    await getSplitBill(app, owner.token, 'not-a-uuid').expect(400);
    await request(app.getHttpServer()).get('/split-bills').expect(401);
  });

  it('accept: лише власник частки; повторне підтвердження → 409', async () => {
    const owner = createUser(ledger);
    const member = createUser(ledger);
    const other = createUser(ledger);
    const created = await postSplitBill(
      app,
      owner.token,
      bill({ participants: [{ email: member.email }, { email: other.email }] }),
    ).expect(201);
    const [mine, theirs] = created.body.shares;

    // Ініціатор, чужий учасник і сторонній не можуть підтвердити частку.
    await acceptShare(app, owner.token, created.body.id, mine.id).expect(404);
    await acceptShare(app, other.token, created.body.id, mine.id).expect(404);
    // Частка з іншого рахунку не підходить.
    await acceptShare(app, member.token, randomUUID(), mine.id).expect(404);
    await acceptShare(app, member.token, created.body.id, randomUUID()).expect(404);

    const accepted = await acceptShare(app, member.token, created.body.id, mine.id).expect(200);
    expect(accepted.body.shares.map((s: { status: string }) => s.status)).toEqual([
      'ACCEPTED',
      'PENDING',
    ]);
    expect(accepted.body.status).toBe('PENDING');
    const again = await acceptShare(app, member.token, created.body.id, mine.id).expect(409);
    expect(again.body.code).toBe('INVALID_SHARE_STATUS');
    expect(theirs.id).not.toBe(mine.id);
  });
});
