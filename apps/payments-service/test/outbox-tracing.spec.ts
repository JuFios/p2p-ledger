import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { OutboxRelay } from '../src/outbox/outbox-relay.service';

const traceId = '12345678901234567890123456789012';
const parentId = '1234567890123456';
const exporter = new tracing.InMemorySpanExporter();
const sdk = new NodeSDK({
  spanProcessors: [new tracing.SimpleSpanProcessor(exporter)],
});

beforeAll(() => sdk.start());
afterEach(() => exporter.reset());
afterAll(() => sdk.shutdown());

function setup(fail = false) {
  const row = {
    id: '9007199254740993', event_id: 'event-1', type: 'MoneyDeposited', version: 1,
    payload: {}, user_ids: [], created_at: new Date(),
    traceparent: `00-${traceId}-${parentId}-01`,
  };
  const query = jest.fn(async (sql: string) => {
    if (sql.includes('advisory')) return [{ locked: true }];
    if (sql.includes('SELECT id')) return [row];
    return [];
  });
  const pipeline = {
    xadd: jest.fn(),
    exec: jest.fn(async () => [[fail ? new Error('Redis unavailable') : null, '1-0']]),
  };
  const relay = new OutboxRelay(
    { transaction: async (run: (manager: unknown) => unknown) => run({ query }) } as unknown as DataSource,
    { status: 'ready', pipeline: () => pipeline } as unknown as Redis,
    new ConfigService({}), {} as SchedulerRegistry,
  );
  return { relay, query, pipeline };
}

it('publishes a child span context in both the stream fields and envelope', async () => {
  const { relay, pipeline } = setup();
  await relay.publishPending();
  const [span] = exporter.getFinishedSpans();
  expect(span.name).toBe('publish MoneyDeposited');
  expect(span.kind).toBe(SpanKind.PRODUCER);
  expect(span.spanContext().traceId).toBe(traceId);
  expect(span.parentSpanContext?.spanId).toBe(parentId);
  const args = pipeline.xadd.mock.calls[0] as unknown as string[];
  const carrier = args[args.indexOf('traceparent') + 1];
  expect(carrier).toBe(`00-${traceId}-${span.spanContext().spanId}-01`);
  expect(JSON.parse(args[args.indexOf('envelope') + 1]).traceparent).toBe(carrier);
});

it('ends failed publish spans and leaves outbox unpublished for retry', async () => {
  const { relay, query } = setup(true);
  await expect(relay.publishPending()).rejects.toThrow('Redis unavailable');
  expect(exporter.getFinishedSpans()[0].status.code).toBe(SpanStatusCode.ERROR);
  expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE outbox'))).toBe(false);
});

it('preserves the exact outbox position across publication retries', async () => {
  const { relay, pipeline } = setup();
  await relay.publishPending();
  await relay.publishPending();
  const positions = pipeline.xadd.mock.calls.map((call) => {
    const args = call as unknown as string[];
    return JSON.parse(args[args.indexOf('envelope') + 1]).position;
  });
  expect(positions).toEqual(['9007199254740993', '9007199254740993']);
});
