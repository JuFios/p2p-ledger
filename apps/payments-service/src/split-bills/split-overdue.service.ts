import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource, In } from 'typeorm';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { SplitShare } from './entities/split-share.entity';
import { splitShareOverdue } from './split-events';

const BATCH = 100;

// Частіше за це воркер не прокидається, навіть якщо інтервал нагадувань
// більший: так нагадування виходить не пізніше ніж за хвилину після терміну.
const MAX_TICK_MS = 60_000;

// Воркер split-overdue: прострочені неоплачені частки → outbox
// SplitShareOverdue, не частіше ніж раз на SPLIT_REMINDER_INTERVAL_MS для
// кожної частки (last_reminded_at). Частка в PAYING не нагадується: оплата
// вже триває. FOR UPDATE SKIP LOCKED: кілька інстансів не надішлють дублів.
@Injectable()
export class SplitOverdueWorker implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(SplitOverdueWorker.name);
  private running?: Promise<unknown>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    this.scheduler.addInterval(
      'split-overdue',
      setInterval(() => this.tick(), Math.min(this.reminderMs, MAX_TICK_MS)),
    );
  }

  async beforeApplicationShutdown() {
    this.scheduler.deleteInterval('split-overdue');
    await this.running;
  }

  private tick() {
    if (this.running) return;
    this.running = this.runOnce()
      .catch((error) => this.logger.error(`Split overdue: ${error}`))
      .finally(() => (this.running = undefined));
  }

  // Повертає кількість надісланих нагадувань.
  async runOnce(): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const rows: { id: string }[] = await manager.query(
        `SELECT share.id
         FROM split_shares share
         JOIN split_bills bill ON bill.id = share.bill_id
         WHERE share.status IN ('PENDING', 'ACCEPTED')
           AND bill.due_at < now()
           AND (share.last_reminded_at IS NULL
                OR share.last_reminded_at < now() - make_interval(secs => $1::numeric / 1000))
         ORDER BY bill.due_at
         LIMIT $2
         FOR UPDATE OF share SKIP LOCKED`,
        [this.reminderMs, BATCH],
      );
      if (rows.length === 0) return 0;
      const shares = await manager.find(SplitShare, {
        where: { id: In(rows.map((row) => row.id)) },
        relations: { bill: true },
      });
      await manager.update(
        SplitShare,
        { id: In(shares.map((share) => share.id)) },
        { lastRemindedAt: () => 'now()' },
      );
      await manager.save(
        OutboxMessage,
        shares.map((share) => splitShareOverdue(share.bill, share)),
      );
      return shares.length;
    });
  }

  private get reminderMs(): number {
    return this.config.getOrThrow<number>('SPLIT_REMINDER_INTERVAL_MS');
  }
}
