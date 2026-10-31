import { INestApplication } from '@nestjs/common';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { createApp, deposit } from './helpers';
import { account } from './ledger-helpers';

describe('Outbox relay (e2e)', () => {
  let app: INestApplication;
  let redis: Redis;

  beforeAll(async () => {
    app = await createApp();
    redis = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT),
    });
  });

  afterAll(async () => {
    await app.close();
    await redis.quit();
  });

  it('публікує подію з outbox у stream:ledger-events і позначає її опублікованою', async () => {
    const a = await account(app, 'USD', 0);
    await deposit(app, a.token, a.walletId, 25);
    const dataSource = app.get(DataSource);
    const [row] = await dataSource.query(
      `SELECT event_id FROM outbox WHERE payload->>'walletId' = $1 AND type = 'MoneyDeposited'`,
      [a.walletId],
    );

    let entry: Record<string, string> | undefined;
    for (let i = 0; i < 50 && !entry; i++) {
      const entries = await redis.xrevrange('stream:ledger-events', '+', '-', 'COUNT', 200);
      const found = entries.find(([, fields]) => fields[1] === row.event_id);
      if (found) {
        const fields = found[1];
        entry = Object.fromEntries(
          fields.flatMap((_, j) => (j % 2 === 0 ? [[fields[j], fields[j + 1]]] : [])),
        );
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    expect(entry).toMatchObject({ eventId: row.event_id, type: 'MoneyDeposited', version: '1' });
    expect(JSON.parse(entry!.envelope)).toMatchObject({
      eventId: row.event_id,
      type: 'MoneyDeposited',
      version: 1,
      producer: 'ledger-service',
      userIds: [a.userId],
      payload: {
        walletId: a.walletId,
        ownerId: a.userId,
        currency: 'USD',
        amount: '25.00',
        balanceAfter: { available: '25.00', held: '0.00' },
      },
    });
    const [published] = await dataSource.query(
      'SELECT published_at FROM outbox WHERE event_id = $1',
      [row.event_id],
    );
    expect(published.published_at).not.toBeNull();
  });
});
