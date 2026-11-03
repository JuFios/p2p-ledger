import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource } from 'typeorm';
import { ReconciliationQueryDto } from '../src/admin/dto/reconciliation-query.dto';
import { reconcile } from '../src/admin/reconciliation';
it.each(['0000-01-01', '2026-W01', '20261103', '2026-02-31', '2026-366', '2026-11-03T25:00:00Z'])('rejects unsupported reconciliation date %s', (from) => {
  expect(validateSync(plainToInstance(ReconciliationQueryDto, { from }))).not.toHaveLength(0);
});
it('rejects invalid domain dates before starting SQL', async () => {
  const db = { transaction: jest.fn() };
  await expect(reconcile(db as unknown as DataSource, { from: new Date(NaN) })).rejects.toBeInstanceOf(BadRequestException);
  expect(db.transaction).not.toHaveBeenCalled();
});
