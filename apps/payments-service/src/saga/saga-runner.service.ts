import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { propagation, ROOT_CONTEXT, trace } from '@opentelemetry/api';
import { DataSource, In } from 'typeorm';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import {
  Transfer,
  TransferStatus,
} from '../transfers/entities/transfer.entity';
import { transferStatusChanged } from '../transfers/transfer-events';
import { decide, TransferSaga } from './transfer-saga';

const BATCH = 20;

export const ACTIVE_STATUSES: TransferStatus[] = [
  'PENDING',
  'PROCESSING',
  'AWAITING_RETRY',
  'COMPENSATING',
];

const tracer = trace.getTracer('payments-service');

// Saga runner: підхоплює перекази, яким настав час наступного кроку, і веде
// їх до фіналу. Патерн «claim»: коротка транзакція бере lease (locked_until),
// HTTP-виклик ledger іде поза транзакцією, результат фіксується окремою
// транзакцією разом з outbox. Процес упав посеред кроку — lease протухає,
// і переказ підхоплює будь-який runner.
@Injectable()
export class SagaRunner implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger(SagaRunner.name);
  private running?: Promise<unknown>;

  constructor(
    private readonly dataSource: DataSource,
    private readonly saga: TransferSaga,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const intervalMs = this.config.getOrThrow<number>('SAGA_RUNNER_INTERVAL_MS');
    this.scheduler.addInterval(
      'saga-runner',
      setInterval(() => this.tick(), intervalMs),
    );
  }

  // Новий тік не стартує, поки попередній не закінчився; на зупинці
  // дочікуємось кроків, що виконуються.
  async beforeApplicationShutdown() {
    this.scheduler.deleteInterval('saga-runner');
    await this.running;
  }

  private tick() {
    if (this.running) return;
    this.running = this.runOnce()
      .catch((error) => this.logger.error(`Saga runner: ${error}`))
      .finally(() => (this.running = undefined));
  }

  async runOnce(): Promise<number> {
    const claimed = await this.claim(BATCH);
    await Promise.all(claimed.map((transfer) => this.drive(transfer)));
    return claimed.length;
  }

  // Lease на SAGA_STEP_TIMEOUT_MS. SKIP LOCKED: паралельні runner'и беруть
  // різні перекази; перекази з чинним lease не беруться взагалі.
  async claim(limit: number): Promise<Transfer[]> {
    // UPDATE … RETURNING обгорнуто в CTE: результат query() для SELECT —
    // завжди масив рядків, незалежно від версії драйвера TypeORM.
    const rows: { id: string }[] = await this.dataSource.query(
      `WITH claimed AS (
         UPDATE transfers
         SET locked_until = now() + make_interval(secs => $1::numeric / 1000)
         WHERE id IN (
           SELECT id FROM transfers
           WHERE status = ANY($2)
             AND next_attempt_at <= now()
             AND (locked_until IS NULL OR locked_until < now())
           ORDER BY next_attempt_at
           LIMIT $3
           FOR UPDATE SKIP LOCKED
         )
         RETURNING id
       )
       SELECT id FROM claimed`,
      [this.leaseMs, ACTIVE_STATUSES, limit],
    );
    if (rows.length === 0) return [];
    return this.dataSource.manager.findBy(Transfer, {
      id: In(rows.map((row) => row.id)),
    });
  }

  // Кроки виконуються підряд, поки сага не дійде до фіналу чи ретраю.
  async drive(transfer: Transfer): Promise<void> {
    let current: Transfer | null = transfer;
    while (current) {
      current = await this.step(current);
    }
  }

  // Один крок у span `saga.step <STEP>`, дочірньому до контексту запиту
  // POST /transfers: уся сага з ретраями — один trace.
  private step(transfer: Transfer): Promise<Transfer | null> {
    const parent = transfer.traceparent
      ? propagation.extract(ROOT_CONTEXT, { traceparent: transfer.traceparent })
      : ROOT_CONTEXT;
    return tracer.startActiveSpan(
      `saga.step ${transfer.step}`,
      { attributes: { 'transfer.id': transfer.id } },
      parent,
      async (span) => {
        try {
          const result = await this.saga.execute(transfer);
          span.setAttribute('saga.result', result.type);
          const transition = decide(
            transfer,
            result,
            new Date(),
            this.saga.settings,
          );
          const saved = await this.commit(transfer, transition);
          return saved && transition.continue ? saved : null;
        } finally {
          span.end();
        }
      },
    );
  }

  // Фіксує результат кроку. Якщо стан переказу вже не той, з яким крок
  // стартував (lease протух і крок виконав інший runner), результат
  // відкидається: виклики ledger ідемпотентні, тож подвійне виконання кроку
  // нічого не зламало.
  private commit(
    before: Transfer,
    transition: ReturnType<typeof decide>,
  ): Promise<Transfer | null> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(Transfer, {
        where: { id: before.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !row ||
        row.status !== before.status ||
        row.step !== before.step ||
        row.attempts !== before.attempts
      ) {
        this.logger.warn(`Переказ ${before.id}: lease втрачено, результат відкинуто`);
        return null;
      }
      Object.assign(row, transition.patch, {
        status: transition.status,
        step: transition.step,
        attempts: transition.attempts,
        nextAttemptAt: transition.nextAttemptAt,
        failureReason: transition.failureReason,
        // Наступний крок іде одразу під тим самим (продовженим) lease.
        lockedUntil: transition.continue
          ? new Date(Date.now() + this.leaseMs)
          : null,
      });
      const saved = await manager.save(row);
      if (saved.status !== before.status || saved.step !== before.step) {
        await manager.save(OutboxMessage, transferStatusChanged(saved));
      }
      return saved;
    });
  }

  private get leaseMs(): number {
    return this.config.getOrThrow<number>('SAGA_STEP_TIMEOUT_MS');
  }
}
