import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../src/outbox/outbox-relay.service';

describe('OutboxRelay', () => {
  const setup = (redisStatus: string, gotLock: boolean) => {
    const query = jest.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_xact_lock') ? [{ locked: gotLock }] : [],
    );
    const dataSource = {
      transaction: jest.fn(async (cb) => cb({ query })),
    };
    const relay = new OutboxRelay(
      dataSource as unknown as DataSource,
      { status: redisStatus, pipeline: jest.fn() } as unknown as Redis,
      new ConfigService({}),
      {} as SchedulerRegistry,
    );
    return { relay, dataSource, query };
  };

  it('поки Redis недоступний, не відкриває транзакцію й не блокує outbox', async () => {
    const { relay, dataSource } = setup('reconnecting', true);
    await relay.publishPending();
    expect(dataSource.transaction).not.toHaveBeenCalled();
  });

  it('другий relay не читає outbox, поки публікує перший (порядок у стрімі)', async () => {
    const { relay, query } = setup('ready', false);
    await relay.publishPending();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('pg_try_advisory_xact_lock');
  });
});
