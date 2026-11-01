import {
  propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace,
} from '@opentelemetry/api';
import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { EventHandler } from './event-handler.service';
import { KNOWN_TYPES, parseEnvelope } from './event-mapper';

export const STREAMS = ['stream:ledger-events', 'stream:payments-events'];
export const GROUP = 'notifications';
export const DEAD_LETTER_STREAM = 'stream:dead-letter';
type Entry = [string, string[]];
type ReadResult = [string, Entry[]][];

@Injectable()
export class StreamConsumer
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(StreamConsumer.name);
  readonly redis: Redis;
  private readonly reader: Redis;
  private stopped = false;
  private running?: Promise<void>;
  private readonly cursors = new Map(STREAMS.map((stream) => [stream, '0-0']));
  private readonly name: string;
  private readonly idle: number;
  private readonly maxDeliveries: number;

  constructor(
    config: ConfigService,
    private readonly handler: EventHandler,
  ) {
    this.name = config.getOrThrow<string>('CONSUMER_NAME');
    this.idle = config.getOrThrow<number>('CONSUMER_CLAIM_IDLE_MS');
    this.maxDeliveries = config.getOrThrow<number>('CONSUMER_MAX_DELIVERIES');
    this.redis = new Redis({
      host: config.getOrThrow<string>('REDIS_HOST'),
      port: config.getOrThrow<number>('REDIS_PORT'),
      maxRetriesPerRequest: 1,
      commandTimeout: 3000,
    });
    this.reader = this.redis.duplicate();
    for (const client of [this.redis, this.reader])
      client.on('error', (error) => this.logger.warn(error.message));
  }

  onApplicationBootstrap() {
    this.running = this.run();
  }

  async beforeApplicationShutdown() {
    if (this.stopped) return this.running;
    this.stopped = true;
    this.reader.disconnect();
    await this.running;
    this.redis.disconnect();
  }

  private async run() {
    while (!this.stopped) {
      try {
        await this.ensureGroups();
        while (!this.stopped) {
          for (const stream of STREAMS) await this.reclaim(stream);
          const messages = (await this.reader.xreadgroup(
            'GROUP',
            GROUP,
            this.name,
            'COUNT',
            20,
            'BLOCK',
            500,
            'STREAMS',
            ...STREAMS,
            ...STREAMS.map(() => '>'),
          )) as ReadResult | null;
          for (const [stream, entries] of messages ?? []) {
            for (const entry of entries) {
              if (this.stopped) return;
              await this.process(stream, entry);
            }
          }
        }
      } catch (error) {
        if (!this.stopped) {
          this.logger.warn(`Consumer retry: ${(error as Error).message}`);
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    }
  }

  private async ensureGroups() {
    for (const stream of STREAMS) {
      try {
        await this.redis.xgroup('CREATE', stream, GROUP, '0', 'MKSTREAM');
      } catch (error) {
        if (!(error as Error).message.includes('BUSYGROUP')) throw error;
      }
    }
  }

  private async reclaim(stream: string) {
    const [cursor, entries] = (await this.redis.xautoclaim(
      stream,
      GROUP,
      this.name,
      this.idle,
      this.cursors.get(stream)!,
      'COUNT',
      20,
    )) as [string, Entry[], string[]];
    this.cursors.set(stream, cursor);
    for (const entry of entries) {
      if (this.stopped) return;
      await this.process(stream, entry);
    }
  }

  private async process(stream: string, [id, fields]: Entry) {
    const values: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2)
      values[fields[i]] = fields[i + 1];
    const parent = propagation.extract(ROOT_CONTEXT, values);
    return trace.getTracer('notifications-service').startActiveSpan(
      `process ${values.type ?? 'unknown'}`,
      {
        kind: SpanKind.CONSUMER,
        attributes: { 'messaging.message.id': values.eventId ?? id },
      },
      parent,
      async (span) => {
        try {
          const event = parseEnvelope(values.envelope);
          if (!KNOWN_TYPES.includes(event.type)) {
            this.logger.warn(`Unknown event type: ${event.type}`);
          } else if (event.version > 1) {
            span.setStatus({
              code: SpanStatusCode.ERROR,
              message: 'Unsupported event version',
            });
            await this.deadLetter(stream, id, fields, 'Unsupported event version');
            return;
          } else {
            await this.handler.handle(event, id);
          }
          await this.redis.xack(stream, GROUP, id);
          this.logger.log(
            { eventId: event.eventId, type: event.type },
            'Event processed',
          );
        } catch (error) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          const errorMessage = (error as Error).message;
          this.logger.warn(`Event ${stream}/${id}: ${errorMessage}`);
          const pending = (await this.redis.xpending(stream, GROUP, id, id, 1)) as [
            string, string, number, number,
          ][];
          if (pending[0] && Number(pending[0][3]) >= this.maxDeliveries) {
            await this.deadLetter(stream, id, fields, errorMessage);
          }
        } finally {
          span.end();
        }
      },
    );
  }

  private async deadLetter(
    stream: string,
    id: string,
    fields: string[],
    reason: string,
  ) {
    // XADD і XACK атомарні; повтор після втраченої відповіді не дублює DLQ.
    await this.redis.eval(
      `
      if #redis.call('XPENDING', KEYS[1], ARGV[1], ARGV[2], ARGV[2], 1) == 0 then return 0 end
      redis.call('XADD', KEYS[2], '*', 'sourceStream', KEYS[1], 'sourceId', ARGV[2],
        'reason', ARGV[3], 'fields', ARGV[4])
      return redis.call('XACK', KEYS[1], ARGV[1], ARGV[2])
    `,
      2,
      stream,
      DEAD_LETTER_STREAM,
      GROUP,
      id,
      reason,
      JSON.stringify(fields),
    );
    this.logger.warn(`Dead letter ${stream}/${id}: ${reason}`);
  }
}
