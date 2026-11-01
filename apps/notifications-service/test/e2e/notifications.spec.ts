import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { Activity } from '../../src/activity/activity.entity';
import { configureApp } from '../../src/configure-app';
import { EventHandler } from '../../src/events/event-handler.service';
import { IntegrationEvent } from '../../src/events/event-mapper';
import {
  DEAD_LETTER_STREAM,
  GROUP,
  STREAMS,
  StreamConsumer,
} from '../../src/events/stream-consumer.service';

const alice = randomUUID();
const bob = randomUUID();
const walletId = randomUUID();
const resources = new Set<string>([walletId]);
let nextPosition = 0n;
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const token = (userId: string) =>
  jwt.sign({ sub: userId, email: `${userId}@test.local`, role: 'user' });
const ledgerEvent = (ownerId = alice): IntegrationEvent => ({
  eventId: randomUUID(),
  position: (++nextPosition).toString(),
  type: 'MoneyDeposited',
  version: 1,
  occurredAt: new Date().toISOString(),
  producer: 'ledger-service',
  userIds: [ownerId],
  payload: {
    walletId,
    ownerId,
    currency: 'USD',
    amount: '10.00',
    balanceAfter: { available: '10.00', held: '2.00' },
  },
});
async function until<T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const value = await read();
    if (check(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

describe('Notifications with PostgreSQL and Redis', () => {
  let app: INestApplication;
  let db: DataSource;
  let redis: Redis;
  let consumer: StreamConsumer;
  let url: string;
  const sockets: Socket[] = [];
  const reclaimed = ledgerEvent();
  let crashedId: string;
  const eventIds: string[] = [];
  const received: Record<string, unknown>[] = [];

  async function publish(event: IntegrationEvent, stream = STREAMS[0]) {
    eventIds.push(event.eventId);
    return (await redis.xadd(
      stream,
      '*',
      'eventId',
      event.eventId,
      'type',
      event.type,
      'version',
      String(event.version),
      'envelope',
      JSON.stringify(event),
    ))!;
  }
  async function processed(eventId: string) {
    return db.query('SELECT * FROM processed_events WHERE event_id = $1', [
      eventId,
    ]);
  }
  async function acked(stream: string, id: string) {
    await until(async () => {
      const rows = (await redis.xpending(
        stream,
        GROUP,
        id,
        id,
        1,
      )) as unknown[];
      const groups = (await redis.xinfo('GROUPS', stream)) as (
        string | number
      )[][];
      const group = groups.find((row) => row[1] === GROUP)!;
      const last = String(group[group.indexOf('last-delivered-id') + 1]);
      const [ms, seq] = last.split('-').map(BigInt);
      const [targetMs, targetSeq] = id.split('-').map(BigInt);
      return (
        rows.length === 0 &&
        (ms > targetMs || (ms === targetMs && seq >= targetSeq))
      );
    }, Boolean);
  }
  async function connect(userId: string) {
    const socket = io(`${url}/ws`, {
      auth: { token: token(userId) },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }
  beforeAll(async () => {
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
    for (const stream of STREAMS) {
      try {
        await redis.xgroup('CREATE', stream, GROUP, '0', 'MKSTREAM');
      } catch (error) {
        if (!(error as Error).message.includes('BUSYGROUP')) throw error;
      }
    }
    crashedId = await publish(reclaimed);
    await redis.xreadgroup(
      'GROUP',
      GROUP,
      'crashed-consumer',
      'STREAMS',
      STREAMS[0],
      '>',
    );
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    app.useLogger(false);
    configureApp(app);
    await app.listen(0);
    url = await app.getUrl();
    db = app.get(DataSource);
    consumer = app.get(StreamConsumer);
  });
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    if (app) {
      await consumer.beforeApplicationShutdown();
      await db.query('DELETE FROM activity WHERE event_id = ANY($1::uuid[])', [
        eventIds,
      ]);
      await db.query(
        'DELETE FROM processed_events WHERE event_id = ANY($1::uuid[])',
        [eventIds],
      );
      await db.query('DELETE FROM push_update_positions WHERE resource_id = ANY($1::uuid[])', [[...resources]]);
      await app.close();
    }
    if (redis) await redis.quit();
  });

  it('reclaims an unacknowledged message from a crashed consumer', async () => {
    await until(
      () => processed(reclaimed.eventId),
      (rows) => rows.length === 1,
    );
    await acked(STREAMS[0], crashedId);
    expect(
      await db.getRepository(Activity).countBy({ eventId: reclaimed.eventId }),
    ).toBe(1);
  });
  it('requires valid access JWTs for REST and WebSocket', async () => {
    await request(app.getHttpServer()).get('/activity').expect(401);
    await request(app.getHttpServer())
      .get('/activity')
      .auth(jwt.sign({ role: 'user' }), { type: 'bearer' })
      .expect(401);
    for (const invalid of [
      undefined,
      'invalid',
      jwt.sign({ sub: alice }, { expiresIn: -1 }),
      jwt.sign({ role: 'user' }),
    ]) {
      const socket = io(`${url}/ws`, {
        auth: { token: invalid },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      const error = await new Promise<Error>((resolve, reject) => {
        socket.once('connect_error', resolve);
        socket.once('connect', () =>
          reject(new Error('Unexpected connection')),
        );
      });
      expect(error.message).toBe('Unauthorized');
      expect(socket.connected).toBe(false);
    }
  });
  it('commits before pushing, deduplicates concurrent deliveries and isolates user rooms', async () => {
    const a = await connect(alice);
    const b = await connect(bob);
    a.on('activity.created', (payload) => received.push(payload));
    const bobEvents: unknown[] = [];
    b.onAny((...args) => bobEvents.push(args));
    const event = ledgerEvent();
    const push = new Promise<Record<string, unknown>>((resolve) =>
      a.once('wallet.balance', resolve),
    );
    const [first, second] = await Promise.all([
      publish(event),
      publish(event, STREAMS[1]),
    ]);
    expect(await push).toEqual({
      walletId,
      currency: 'USD',
      balance: '12.00',
      available: '10.00',
      held: '2.00',
    });
    expect(await processed(event.eventId)).toHaveLength(1);
    await acked(STREAMS[0], first);
    await acked(STREAMS[1], second);
    expect(
      await db.getRepository(Activity).countBy({ eventId: event.eventId }),
    ).toBe(1);
    expect(
      received.filter((row) => row.eventId === event.eventId),
    ).toHaveLength(1);
    expect(bobEvents).toHaveLength(0);
    const bobEvent = ledgerEvent(bob);
    const bobPush = new Promise<void>((resolve) =>
      b.once('activity.created', () => resolve()),
    );
    await publish(bobEvent);
    await bobPush;
    expect(bobEvents).not.toHaveLength(0);
  });
  it('filters activity by owner, type and limit and validates query parameters', async () => {
    const response = await request(app.getHttpServer())
      .get('/activity?type=DEPOSIT&limit=1')
      .auth(token(alice), { type: 'bearer' })
      .expect(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toEqual(
      expect.objectContaining({ userId: alice, type: 'DEPOSIT' }),
    );
    const bobRows = await request(app.getHttpServer())
      .get('/activity')
      .auth(token(bob), { type: 'bearer' })
      .expect(200);
    expect(bobRows.body.every((row: Activity) => row.userId === bob)).toBe(
      true,
    );
    for (const query of [
      'type=invalid',
      'limit=0',
      'limit=101',
      'limit=abc',
      'limit=1.5',
    ]) {
      await request(app.getHttpServer())
        .get(`/activity?${query}`)
        .auth(token(alice), { type: 'bearer' })
        .expect(400);
    }
  });
  it('acknowledges unknown types without activity', async () => {
    const event = { ...ledgerEvent(), type: 'FutureEvent' };
    const id = await publish(event);
    await acked(STREAMS[0], id);
    expect(await processed(event.eventId)).toHaveLength(0);
    expect(
      await db.getRepository(Activity).countBy({ eventId: event.eventId }),
    ).toBe(0);
  });
  it('dead-letters unsupported versions immediately', async () => {
    const event = { ...ledgerEvent(), version: 2 };
    const id = await publish(event);
    await until(
      () => redis.xrange(DEAD_LETTER_STREAM, '-', '+'),
      (entries) => entries.some(([, fields]) => fields.includes(id)),
    );
    await acked(STREAMS[0], id);
    expect(await processed(event.eventId)).toHaveLength(0);
  });
  it('rolls back processed_events on failure and dead-letters after the configured number of deliveries', async () => {
    const event = ledgerEvent();
    event.payload.walletId = 'invalid';
    const spy = jest.spyOn(app.get(EventHandler), 'handle');
    const id = await publish(event);
    await until(
      () => redis.xrange(DEAD_LETTER_STREAM, '-', '+'),
      (entries) => entries.some(([, fields]) => fields.includes(id)),
    );
    await acked(STREAMS[0], id);
    expect(
      spy.mock.calls.filter(([value]) => value.eventId === event.eventId),
    ).toHaveLength(3);
    spy.mockRestore();
    expect(await processed(event.eventId)).toHaveLength(0);
    expect(
      await db.getRepository(Activity).countBy({ eventId: event.eventId }),
    ).toBe(0);
    const dead = (await redis.xrange(DEAD_LETTER_STREAM, '-', '+')).filter(
      ([, fields]) => fields.includes(id),
    );
    expect(dead).toHaveLength(1);
  });
  it('retries an acknowledgement failure without repeating committed activity or pushes', async () => {
    const event = ledgerEvent();
    const original = consumer.redis.xack.bind(consumer.redis);
    let failed = false;
    const spy = jest
      .spyOn(consumer.redis, 'xack')
      .mockImplementation((...args: Parameters<typeof original>) => {
        if (!failed) {
          failed = true;
          return Promise.reject(new Error('Lost ACK response'));
        }
        return original(...args);
      });
    const id = await publish(event);
    await until(
      () => processed(event.eventId),
      (rows) => rows.length === 1,
    );
    await acked(STREAMS[0], id);
    spy.mockRestore();
    expect(failed).toBe(true);
    expect(
      await db.getRepository(Activity).countBy({ eventId: event.eventId }),
    ).toBe(1);
    expect(
      received.filter((row) => row.eventId === event.eventId),
    ).toHaveLength(1);
  });
  it('reclaims older activity without regressing a newer wallet balance', async () => {
    const older = ledgerEvent();
    const newer = ledgerEvent();
    const isolatedWallet = randomUUID();
    older.payload.walletId = isolatedWallet;
    newer.payload.walletId = isolatedWallet;
    older.payload.balanceAfter = { available: '100.00', held: '0.00' };
    newer.payload.balanceAfter = { available: '200.00', held: '0.00' };
    const pushes: string[] = [];
    const socket = await connect(alice);
    const delivered: string[] = [];
    socket.on('activity.created', (value) => delivered.push(value.eventId));
    socket.on('wallet.balance', (value) => {
      if (value.walletId === isolatedWallet) pushes.push(value.balance);
    });
    const handler = app.get(EventHandler);
    const original = handler.handle.bind(handler);
    let failed = false;
    let newerId = '';
    const spy = jest.spyOn(handler, 'handle').mockImplementation(async (event) => {
      if (event.eventId === older.eventId && !failed) {
        failed = true;
        newerId = await publish(newer);
        throw new Error('Transient failure');
      }
      await original(event);
    });
    try {
      const olderId = await publish(older);
      await until(() => processed(older.eventId), (rows) => rows.length === 1);
      await acked(STREAMS[0], olderId);
      await acked(STREAMS[0], newerId);
      // Сигнал activity старої події приходить після усіх попередніх emit.
      await until(async () => delivered, (ids) => ids.includes(older.eventId));
      expect(pushes).toEqual(['200.00']);
      expect(await processed(newer.eventId)).toHaveLength(1);
      expect(await db.getRepository(Activity).countBy({ eventId: older.eventId })).toBe(1);

      // Новий handler без пам'яті попереднього інстансу теж відкидає старий push.
      const replay = ledgerEvent();
      replay.payload.walletId = isolatedWallet;
      eventIds.push(replay.eventId);
      const gateway = { emit: jest.fn() };
      const { NotificationsGateway } = await import('../../src/events/notifications.gateway');
      const restarted = new EventHandler(db, gateway as unknown as InstanceType<typeof NotificationsGateway>);
      replay.position = '1';
      await restarted.handle(replay);
      expect(gateway.emit.mock.calls.map((call) => call[1])).toEqual(['activity.created']);
      for (const position of ['9007199254740993', '9007199254740992']) {
        const event = ledgerEvent();
        event.payload.walletId = isolatedWallet;
        eventIds.push(event.eventId);
        event.position = position;
        await restarted.handle(event);
      }
      expect(gateway.emit.mock.calls.filter((call) => call[1] === 'wallet.balance')).toHaveLength(1);
    } finally {
      spy.mockRestore();
      socket.disconnect();
      await db.query('DELETE FROM push_update_positions WHERE resource_id = $1', [isolatedWallet]);
    }
  });

  it('does not push a reclaimed intermediate status after a completed transfer', async () => {
    const transferId = randomUUID();
    resources.add(transferId);
    const older: IntegrationEvent = {
      ...ledgerEvent(), position: '100', producer: 'payments-service', type: 'TransferStatusChanged',
      payload: { transferId, senderUserId: alice, status: 'PROCESSING', step: 'HOLD' },
    };
    const newer: IntegrationEvent = {
      ...older, position: '200', eventId: randomUUID(), userIds: [alice, bob],
      payload: { ...older.payload, recipientUserId: bob, status: 'COMPLETED', step: 'DONE' },
    };
    eventIds.push(older.eventId, newer.eventId);
    const pushes: { userId: string; event: string; payload: Record<string, unknown> }[] = [];
    const handler = new EventHandler(db, {
      emit: (userId: string, event: string, payload: Record<string, unknown>) =>
        pushes.push({ userId, event, payload }),
    } as unknown as ConstructorParameters<typeof EventHandler>[1]);
    await handler.handle(newer);
    await handler.handle(older);
    expect(pushes.filter((push) => push.userId === alice && push.event === 'transfer.status')
      .map((push) => push.payload.status)).toEqual(['COMPLETED']);
    expect(pushes.filter((push) => push.userId === bob && push.event === 'transfer.status')
      .map((push) => push.payload.status)).toEqual(['COMPLETED']);
    expect(await processed(older.eventId)).toHaveLength(1);
    expect(await db.getRepository(Activity).countBy({ eventId: newer.eventId })).toBe(2);
  });

  it('does not regress a wallet when an older outbox event is republished', async () => {
    const isolatedWallet = randomUUID();
    const older = ledgerEvent();
    older.payload.walletId = isolatedWallet;
    older.payload.balanceAfter = { available: '100.00', held: '0.00' };
    const newer = ledgerEvent();
    newer.payload.walletId = isolatedWallet;
    newer.payload.balanceAfter = { available: '200.00', held: '0.00' };
    eventIds.push(older.eventId, newer.eventId);
    const balances: unknown[] = [];
    const handler = new EventHandler(db, {
      emit: (_userId: string, event: string, payload: Record<string, unknown>) => {
        if (event === 'wallet.balance') balances.push(payload.balance);
      },
    } as unknown as ConstructorParameters<typeof EventHandler>[1]);
    try {
      // Перша доставка старої події впала; новіша вже оброблена.
      await handler.handle(newer);
      // Relay повторює обидва XADD після rollback із новими Redis ID.
      await handler.handle(older);
      await handler.handle(newer);
      expect(balances).toEqual(['200.00']);
      expect(await db.getRepository(Activity).countBy({ eventId: older.eventId })).toBe(1);
      expect(await db.getRepository(Activity).countBy({ eventId: newer.eventId })).toBe(1);
    } finally {
      await db.query('DELETE FROM push_update_positions WHERE resource_id = $1', [isolatedWallet]);
    }
  });

  it('stores legacy activity without emitting an unordered state snapshot', async () => {
    const legacy = ledgerEvent();
    delete legacy.position;
    eventIds.push(legacy.eventId);
    const calls: string[] = [];
    const handler = new EventHandler(db, {
      emit: (_userId: string, event: string) => calls.push(event),
    } as unknown as ConstructorParameters<typeof EventHandler>[1]);
    await handler.handle(legacy);
    expect(calls).toEqual(['activity.created']);
    expect(await processed(legacy.eventId)).toHaveLength(1);
  });

  it('serves database readiness', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).toEqual(
      expect.objectContaining({
        status: 'ok',
        details: { database: { status: 'up' }, redis: { status: 'up' } },
      }),
    );
  });

  it('persists final transfer and split activity for their recipients', async () => {
    const transferId = randomUUID();
    resources.add(transferId);
    const payment: IntegrationEvent = {
      ...ledgerEvent(),
      producer: 'payments-service',
      type: 'TransferStatusChanged',
      userIds: [alice, bob],
      payload: {
        transferId,
        senderUserId: alice,
        recipientUserId: bob,
        status: 'COMPLETED',
        step: 'DONE',
        amount: '10.00',
        currency: 'USD',
        toAmount: '9.20',
        toCurrency: 'EUR',
      },
    };
    const id = await publish(payment, STREAMS[1]);
    await acked(STREAMS[1], id);
    const rows = await db
      .getRepository(Activity)
      .findBy({ eventId: payment.eventId });
    expect(rows.map((row) => [row.userId, row.type])).toEqual(
      expect.arrayContaining([
        [alice, 'TRANSFER_SENT'],
        [bob, 'TRANSFER_RECEIVED'],
      ]),
    );
    expect(rows).toHaveLength(2);
    const split: IntegrationEvent = {
      ...payment,
      eventId: randomUUID(),
      type: 'SplitBillCreated',
      userIds: [bob],
      payload: {
        billId: randomUUID(),
        title: 'Dinner',
        shares: [{ shareId: randomUUID(), userId: bob, amount: '10.00' }],
      },
    };
    const reminder: IntegrationEvent = {
      ...split,
      eventId: randomUUID(),
      type: 'SplitShareOverdue',
      payload: {
        billId: split.payload.billId,
        shareId: randomUUID(),
        amount: '10.00',
        currency: 'USD',
      },
    };
    for (const event of [split, reminder]) {
      const messageId = await publish(event, STREAMS[1]);
      await acked(STREAMS[1], messageId);
      expect(
        await db.getRepository(Activity).findBy({ eventId: event.eventId }),
      ).toEqual([
        expect.objectContaining({
          userId: bob,
          type:
            event.type === 'SplitBillCreated' ? 'SPLIT_BILL' : 'SPLIT_REMINDER',
        }),
      ]);
    }
  });

  it('serializes concurrent database deliveries of the same event', async () => {
    const event = ledgerEvent();
    eventIds.push(event.eventId);
    const handler = app.get(EventHandler);
    await Promise.all(Array.from({ length: 10 }, () => handler.handle(event)));
    expect(await processed(event.eventId)).toHaveLength(1);
    expect(
      await db.getRepository(Activity).countBy({ eventId: event.eventId }),
    ).toBe(1);
  });

  it('waits for an in-flight transaction and acknowledgement on shutdown', async () => {
    const event = ledgerEvent();
    const handler = app.get(EventHandler);
    const original = handler.handle.bind(handler);
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = jest
      .spyOn(handler, 'handle')
      .mockImplementation(async (value) => {
        if (value.eventId === event.eventId) {
          entered();
          await gate;
        }
        await original(value);
      });
    const id = await publish(event);
    await started;
    let stopped = false;
    const shutdown = consumer.beforeApplicationShutdown().then(() => {
      stopped = true;
    });
    try {
      await new Promise((resolve) => setImmediate(resolve));
      expect(stopped).toBe(false);
    } finally {
      release();
      await shutdown;
      spy.mockRestore();
    }
    expect(await processed(event.eventId)).toHaveLength(1);
    await acked(STREAMS[0], id);
  });
});
