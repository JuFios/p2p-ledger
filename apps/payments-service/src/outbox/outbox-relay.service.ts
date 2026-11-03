import {
  context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace,
} from '@opentelemetry/api';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { REDIS } from '../redis/redis.module';

export const PAYMENTS_EVENTS_STREAM = 'stream:payments-events';

const BATCH = 100;

// Ключ advisory lock relay: публікує лише один інстанс одночасно.
const RELAY_LOCK = 0x7061796d; // 'paym'

interface OutboxRow {
  id: string;
  event_id: string;
  type: string;
  version: number;
  payload: Record<string, unknown>;
  user_ids: string[];
  traceparent: string | null;
  created_at: Date;
}

// Outbox relay: неопубліковані рядки outbox → XADD у Redis Stream → published_at.
// XADD виконується до коміту, тож падіння між ними дає повторну публікацію
// (at-least-once) — її поглинає дедуплікація консюмера за eventId.
// Кілька інстансів не публікують паралельно (advisory lock): інакше сусідні
// батчі потрапили б у стрім упереміш. Записи одного гаманця серіалізовано
// його блокуванням, тому порядок outbox.id відповідає порядку змін гаманця.
// Стабільний outbox.id зберігає порядок
// станів ресурсу також при повторній публікації.
@Injectable()
export class OutboxRelay implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private running?: Promise<void>;

  constructor(
    private readonly dataSource: DataSource,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const intervalMs = Number(this.config.get('OUTBOX_POLL_INTERVAL_MS', 500));
    this.scheduler.addInterval(
      'outbox-relay',
      setInterval(() => this.tick(), intervalMs),
    );
  }

  // Новий тік не стартує, поки попередній не закінчився; на зупинці
  // дочікуємось поточного батча.
  async beforeApplicationShutdown() {
    this.scheduler.deleteInterval('outbox-relay');
    await this.running;
  }

  private tick() {
    if (this.running) return;
    this.running = this.publishPending()
      .catch((error) => this.logger.error(`Outbox relay: ${error}`))
      .finally(() => (this.running = undefined));
  }

  async publishPending(): Promise<void> {
    while ((await this.publishBatch()) === BATCH);
  }

  private async publishBatch(): Promise<number> {
    // Поки Redis недоступний, не тримаємо транзакцію й блокування outbox
    // в очікуванні таймауту XADD.
    if (this.redis.status !== 'ready') return 0;
    const maxLen = Number(this.config.get('STREAM_MAXLEN', 100000));
    return this.dataSource.transaction(async (manager) => {
      const [{ locked }]: { locked: boolean }[] = await manager.query(
        'SELECT pg_try_advisory_xact_lock($1) AS locked',
        [RELAY_LOCK],
      );
      if (!locked) return 0;
      const rows: OutboxRow[] = await manager.query(
        `SELECT id, event_id, type, version, payload, user_ids, traceparent, created_at
         FROM outbox WHERE published_at IS NULL
         ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return 0;
      const pipeline = this.redis.pipeline();
      const spans = rows.map((row) =>
        trace.getTracer('payments-service').startSpan(
          `publish ${row.type}`,
          {
            kind: SpanKind.PRODUCER,
            attributes: { 'messaging.message.id': row.event_id },
          },
          propagation.extract(ROOT_CONTEXT, { traceparent: row.traceparent ?? '' }),
        ),
      );
      try {
        for (const [index, row] of rows.entries()) {
          const parent = trace.setSpan(ROOT_CONTEXT, spans[index]);
          const carrier: Record<string, string> = {};
          propagation.inject(parent, carrier);
          const envelope = {
            eventId: row.event_id,
            position: row.id,
            type: row.type,
            version: row.version,
            occurredAt: row.created_at.toISOString(),
            producer: 'payments-service',
            userIds: row.user_ids,
            traceparent: carrier.traceparent,
            payload: row.payload,
          };
          pipeline.xadd(
            PAYMENTS_EVENTS_STREAM,
            'MAXLEN',
            '~',
            maxLen,
            '*',
            'eventId',
            row.event_id,
            'type',
            row.type,
            'version',
            row.version,
            'traceparent',
            carrier.traceparent ?? '',
            'envelope',
            JSON.stringify(envelope),
          );
        }
        for (const [error] of (await pipeline.exec()) ?? []) {
          if (error) throw error;
        }
        await manager.query(
          `UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])`,
          [rows.map((row) => row.id)],
        );
        for (const [index, row] of rows.entries()) {
          context.with(trace.setSpan(ROOT_CONTEXT, spans[index]), () =>
            this.logger.log(
              { eventId: row.event_id, type: row.type },
              'Event published',
            ),
          );
        }
        return rows.length;
      } catch (error) {
        for (const span of spans) {
          span.recordException(error as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        throw error;
      } finally {
        for (const span of spans) span.end();
      }
    });
  }
}
