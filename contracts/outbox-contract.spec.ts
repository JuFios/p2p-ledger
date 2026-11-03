import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../src/outbox/outbox-relay.service';

function fixture(results: unknown = [[null, '1-0'], [null, '2-0']]) {
  const rows = ['9007199254740993', '9007199254740994'].map(id => ({ id, event_id: `event-${id}`, type: 'TestEvent', version: 1, payload: {}, user_ids: [], traceparent: null, created_at: new Date() }));
  const query = jest.fn(async (sql: string) => sql.includes('advisory') ? [{ locked: true }] : sql.includes('SELECT id') ? rows : []);
  const pipeline = { xadd: jest.fn(), exec: jest.fn(async () => results) };
  const redis = { status: 'ready', pipeline: () => pipeline };
  const scheduler = { addInterval: jest.fn(), deleteInterval: jest.fn() };
  const relay = new OutboxRelay({ transaction: async (run: (m: unknown) => unknown) => run({ query }) } as unknown as DataSource, redis as unknown as Redis, new ConfigService({}), scheduler as unknown as SchedulerRegistry);
  return { relay, pipeline, query, redis, scheduler };
}
it('preserves ordering and stable positions across duplicate publication', async () => {
  const { relay, pipeline, query } = fixture();
  await relay.publishPending(); await relay.publishPending();
  const positions = pipeline.xadd.mock.calls.map(call => { const args = call as unknown as string[]; return JSON.parse(args[args.indexOf('envelope') + 1]).position; });
  expect(positions).toEqual(['9007199254740993', '9007199254740994', '9007199254740993', '9007199254740994']);
  expect(query.mock.calls.filter(([sql]) => sql.includes('UPDATE outbox'))).toHaveLength(2);
});
it('does not acknowledge a partial pipeline failure', async () => {
  const { relay, query } = fixture([[null, '1-0'], [new Error('unavailable'), null]]);
  await expect(relay.publishPending()).rejects.toThrow('unavailable');
  expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE outbox'))).toBe(false);
});
it('does not open a database transaction while Redis is unavailable', async () => {
  const { relay, redis, query } = fixture(); redis.status = 'reconnecting';
  await relay.publishPending(); expect(query).not.toHaveBeenCalled();
});
it('waits for an in-flight publication during shutdown', async () => {
  jest.useFakeTimers();
  const { relay, scheduler } = fixture();
  let finish!: () => void;
  jest.spyOn(relay, 'publishPending').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  try {
    relay.onModuleInit(); jest.advanceTimersByTime(500);
    let stopped = false;
    const shutdown = relay.beforeApplicationShutdown().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false);
    finish(); await shutdown;
    expect(scheduler.deleteInterval).toHaveBeenCalledWith('outbox-relay');
    expect(stopped).toBe(true);
  } finally { jest.useRealTimers(); }
});
