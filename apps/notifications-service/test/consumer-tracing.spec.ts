import { ConfigService } from '@nestjs/config';
import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { NodeSDK, tracing } from '@opentelemetry/sdk-node';
import { randomUUID } from 'crypto';
import { EventHandler } from '../src/events/event-handler.service';
import { StreamConsumer } from '../src/events/stream-consumer.service';

jest.mock('ioredis', () => jest.fn().mockImplementation(() => {
  const client = {
    on: jest.fn(), duplicate: () => client, disconnect: jest.fn(),
    xack: jest.fn(async () => 1), xpending: jest.fn(async () => []),
  };
  return client;
}));

const traceId = '12345678901234567890123456789012';
const parentId = '1234567890123456';
const exporter = new tracing.InMemorySpanExporter();
const sdk = new NodeSDK({ spanProcessors: [new tracing.SimpleSpanProcessor(exporter)] });
beforeAll(() => sdk.start());
afterEach(() => exporter.reset());
afterAll(() => sdk.shutdown());

function setup(fail = false) {
  const handle = jest.fn(async () => {
    const active = trace.getSpan(context.active())!.spanContext();
    if (fail) throw new Error('Database unavailable');
    return active;
  });
  const consumer = new StreamConsumer(new ConfigService({
    CONSUMER_NAME: 'test', CONSUMER_CLAIM_IDLE_MS: 50, CONSUMER_MAX_DELIVERIES: 3,
    REDIS_HOST: 'localhost', REDIS_PORT: 6380,
  }), { handle } as unknown as EventHandler);
  return { consumer, handle };
}

function fields(traceparent: string) {
  const event = {
    eventId: randomUUID(), type: 'MoneyDeposited', version: 1,
    occurredAt: new Date().toISOString(), producer: 'ledger-service',
    userIds: [randomUUID()], payload: {},
  };
  return ['type', event.type, 'eventId', event.eventId, 'traceparent', traceparent,
    'envelope', JSON.stringify(event)];
}

it('restores the publish parent throughout event handling and ACK', async () => {
  const { consumer, handle } = setup();
  await consumer['process']('stream:ledger-events', ['1-0', fields(`00-${traceId}-${parentId}-01`)]);
  const [span] = exporter.getFinishedSpans();
  expect(span.name).toBe('process MoneyDeposited');
  expect(span.kind).toBe(SpanKind.CONSUMER);
  expect(span.spanContext().traceId).toBe(traceId);
  expect(span.parentSpanContext?.spanId).toBe(parentId);
  expect((await handle.mock.results[0].value).spanId).toBe(span.spanContext().spanId);
  expect(consumer.redis.xack).toHaveBeenCalledWith('stream:ledger-events', 'notifications', '1-0');
});

it('does not attach an untraced delivery to an unrelated active request', async () => {
  const { consumer } = setup();
  await trace.getTracer('test').startActiveSpan('unrelated', async (parent) => {
    await consumer['process']('stream:ledger-events', ['1-0', fields('invalid')]);
    const [span] = exporter.getFinishedSpans();
    expect(span.parentSpanContext).toBeUndefined();
    expect(span.spanContext().traceId).not.toBe(parent.spanContext().traceId);
    parent.end();
  });
});

it('records delivery failure and ends the span while retaining the pending message', async () => {
  const { consumer } = setup(true);
  await consumer['process']('stream:ledger-events', ['1-0', fields(`00-${traceId}-${parentId}-01`)]);
  const [span] = exporter.getFinishedSpans();
  expect(span.status.code).toBe(SpanStatusCode.ERROR);
  expect(span.events[0].name).toBe('exception');
  expect(consumer.redis.xack).not.toHaveBeenCalled();
});
