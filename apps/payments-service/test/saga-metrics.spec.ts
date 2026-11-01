import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { DataSource } from 'typeorm';
import { MetricsService } from '../src/observability/metrics.service';
import { SagaRunner } from '../src/saga/saga-runner.service';
import { StepResult, TransferSaga } from '../src/saga/transfer-saga';
import { Transfer } from '../src/transfers/entities/transfer.entity';

function setup(result: StepResult, commit: 'ok' | 'lost' | 'rollback' = 'ok') {
  const before = {
    id: 'transfer-1', status: 'PROCESSING', step: 'CAPTURE', attempts: 0,
    amountMinor: '100', toAmountMinor: '100', userId: 'user-1',
  } as unknown as Transfer;
  const manager = {
    findOne: async () => commit === 'lost' ? null : { ...before },
    save: async (...args: unknown[]) => args[args.length - 1],
  };
  const db = { transaction: async (run: (manager: unknown) => Promise<unknown>) => {
    const value = await run(manager);
    if (commit === 'rollback') throw new Error('Commit failed');
    return value;
  } } as unknown as DataSource;
  const saga = {
    execute: async () => result,
    settings: { maxAttempts: 3, retryBaseMs: 1000 },
  } as unknown as TransferSaga;
  const metrics = new MetricsService();
  const runner = new SagaRunner(db, saga, new ConfigService({ SAGA_STEP_TIMEOUT_MS: 1000 }),
    {} as SchedulerRegistry, metrics);
  return { runner, before, metrics };
}

it.each([
  [{ type: 'completed' }, 'COMPLETED'],
  [{ type: 'compensated' }, 'FAILED'],
] as [StepResult, string][])('counts a committed terminal transfer: %s', async (result, status) => {
  const { runner, before, metrics } = setup(result);
  await runner.drive(before);
  expect(await metrics.registry.metrics()).toContain(`transfers_total{status="${status}"} 1`);
  expect(await metrics.registry.metrics()).toContain('saga_step_duration_seconds_count{step="CAPTURE"} 1');
  metrics.onModuleDestroy();
});

it.each(['lost', 'rollback'] as const)('does not count a terminal transfer after %s', async (commit) => {
  const { runner, before, metrics } = setup({ type: 'completed' }, commit);
  if (commit === 'rollback') await expect(runner.drive(before)).rejects.toThrow('Commit failed');
  else await runner.drive(before);
  const text = await metrics.registry.metrics();
  expect(text).not.toContain('transfers_total{');
  expect(text).toContain('saga_step_duration_seconds_count{step="CAPTURE"} 1');
  metrics.onModuleDestroy();
});

it('records a retry duration without counting it as a completed transfer', async () => {
  const { runner, before, metrics } = setup({ type: 'uncertain', error: 'timeout' });
  await runner.drive(before);
  const text = await metrics.registry.metrics();
  expect(text).not.toContain('transfers_total{');
  expect(text).toContain('saga_step_duration_seconds_count{step="CAPTURE"} 1');
  metrics.onModuleDestroy();
});
