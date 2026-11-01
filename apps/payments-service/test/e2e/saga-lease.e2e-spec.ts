import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { entities, migrations } from '../../src/data-source';
import { MetricsService } from '../../src/observability/metrics.service';
import { SagaRunner } from '../../src/saga/saga-runner.service';
import { StepResult, TransferSaga } from '../../src/saga/transfer-saga';

// Два runner'и (як два інстанси payments) над однією БД без AppModule:
// кроки саги замінено лічильником, щоб бачити, хто що виконав.
describe('Lease saga runner (інтеграційний, Postgres)', () => {
  let dataSource: DataSource;

  const config = new ConfigService({
    SAGA_STEP_TIMEOUT_MS: 2000,
    SAGA_RUNNER_INTERVAL_MS: 1000,
  });

  function runner(
    execute: (id: string) => Promise<StepResult>,
    db: DataSource = dataSource,
  ) {
    const saga = {
      settings: { maxAttempts: 3, retryBaseMs: 60000 },
      execute: (transfer: { id: string }) => execute(transfer.id),
    } as unknown as TransferSaga;
    return new SagaRunner(
      db,
      saga,
      config,
      {} as SchedulerRegistry,
      new MetricsService(),
    );
  }

  async function insertTransfers(
    count: number,
    lockedUntil: string | null = null,
    status = 'PROCESSING',
  ) {
    const ids = Array.from({ length: count }, () => randomUUID());
    for (const id of ids) {
      await dataSource.query(
        `INSERT INTO transfers (id, sender_user_id, sender_email, idempotency_key,
           request_hash, from_wallet_id, recipient_email, amount_minor, currency,
           to_currency, status, step, next_attempt_at, locked_until)
         VALUES ($1, $2, 's@example.com', $3, 'h', $2, 'r@example.com', 100, 'USD',
           'USD', $4, 'HOLD', now(), ${lockedUntil ?? 'NULL'})`,
        [id, randomUUID(), id, status],
      );
    }
    return ids;
  }

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities,
      migrations,
    });
    await dataSource.initialize();
    await dataSource.runMigrations();
  });

  // Перекази інших тестів не мають потрапити до цих runner'ів.
  beforeEach(() =>
    dataSource.query(
      `UPDATE transfers SET status = 'FAILED' WHERE status <> ALL($1)`,
      [['COMPLETED', 'FAILED']],
    ),
  );

  afterAll(() => dataSource.destroy());

  it('два runner’и паралельно не виконують той самий крок', async () => {
    const ids = await insertTransfers(30);
    const executed: string[] = [];
    const slowRetry = async (id: string): Promise<StepResult> => {
      executed.push(id);
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { type: 'uncertain', error: 'test' };
    };
    const [a, b] = [runner(slowRetry), runner(slowRetry)];
    await Promise.all([a.runOnce(), b.runOnce(), a.runOnce(), b.runOnce()]);

    // Кожен переказ — рівно один раз.
    expect([...executed].sort()).toEqual([...ids].sort());
    const rows: { attempts: number; status: string }[] = await dataSource.query(
      'SELECT attempts, status FROM transfers WHERE id = ANY($1)',
      [ids],
    );
    expect(rows.every((row) => row.attempts === 1 && row.status === 'AWAITING_RETRY')).toBe(true);
  });

  it('claim не чекає на перекази, які саме бере інший runner, і не бере їх повторно', async () => {
    const ids = await insertTransfers(4);
    const noop = async (): Promise<StepResult> => ({ type: 'uncertain', error: '' });
    // Runner A взяв два перекази, але його транзакція claim ще не закомічена.
    const queryRunner = dataSource.createQueryRunner();
    await queryRunner.startTransaction();
    try {
      const inTx = { query: queryRunner.query.bind(queryRunner), manager: queryRunner.manager };
      const claimedA = await runner(noop, inTx as unknown as DataSource).claim(2);
      const claimedB = runner(noop).claim(10);
      const settled = await Promise.race([
        claimedB,
        new Promise((resolve) => setTimeout(() => resolve('blocked'), 500)),
      ]);
      await queryRunner.commitTransaction();
      expect(settled).not.toBe('blocked');
      const idsA = claimedA.map((t) => t.id);
      const idsB = (await claimedB).map((t) => t.id);
      expect(idsA).toHaveLength(2);
      expect(idsB.filter((id) => idsA.includes(id))).toEqual([]);
      expect([...idsA, ...idsB].sort()).toEqual([...ids].sort());
    } finally {
      await queryRunner.release();
    }
  });

  it('чинний lease не підхоплюється, протухлий — підхоплюється', async () => {
    const [held] = await insertTransfers(1, "now() + interval '1 minute'");
    const [expired] = await insertTransfers(1, "now() - interval '1 second'");
    const claimed = await runner(async () => ({ type: 'uncertain', error: '' })).claim(10);
    expect(claimed.map((t) => t.id)).toEqual([expired]);
    expect(claimed.map((t) => t.id)).not.toContain(held);
  });

  it('результат кроку з протухлим lease відкидається, якщо крок уже виконав інший runner', async () => {
    // AWAITING_RETRY: обидва runner'и дають той самий status/step, різниться лише attempts.
    const [id] = await insertTransfers(1, null, 'AWAITING_RETRY');
    const runnerA = runner(async () => {
      // Поки A «висить» на виклику ledger, lease протухає і B робить той самий крок.
      await dataSource.query(`UPDATE transfers SET locked_until = now() - interval '1 second' WHERE id = $1`, [id]);
      await runner(async () => ({ type: 'uncertain', error: 'B' })).runOnce();
      return { type: 'rejected', reason: 'A' };
    });
    await runnerA.runOnce();
    const [row] = await dataSource.query(
      'SELECT status, attempts, failure_reason FROM transfers WHERE id = $1',
      [id],
    );
    // Зафіксовано результат B; A свій (застарілий) результат відкинув.
    expect(row).toEqual({ status: 'AWAITING_RETRY', attempts: 1, failure_reason: null });
  });
});
