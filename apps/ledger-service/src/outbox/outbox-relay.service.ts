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

export const LEDGER_EVENTS_STREAM = 'stream:ledger-events';

const BATCH = 100;

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
// SKIP LOCKED дозволяє кільком інстансам не блокувати одне одного.
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

  private publishBatch(): Promise<number> {
    const maxLen = Number(this.config.get('STREAM_MAXLEN', 100000));
    return this.dataSource.transaction(async (manager) => {
      const rows: OutboxRow[] = await manager.query(
        `SELECT id, event_id, type, version, payload, user_ids, traceparent, created_at
         FROM outbox WHERE published_at IS NULL
         ORDER BY id LIMIT ${BATCH} FOR UPDATE SKIP LOCKED`,
      );
      if (rows.length === 0) return 0;
      const pipeline = this.redis.pipeline();
      for (const row of rows) {
        const envelope = {
          eventId: row.event_id,
          type: row.type,
          version: row.version,
          occurredAt: row.created_at.toISOString(),
          producer: 'ledger-service',
          userIds: row.user_ids,
          traceparent: row.traceparent ?? undefined,
          payload: row.payload,
        };
        pipeline.xadd(
          LEDGER_EVENTS_STREAM,
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
          row.traceparent ?? '',
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
      return rows.length;
    });
  }
}
