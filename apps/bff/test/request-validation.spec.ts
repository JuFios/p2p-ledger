import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSplitBillDto, ReconciliationQuery } from '../src/dto/requests.dto';
it('rejects explicit null in a CUSTOM participant', () => {
  expect(validateSync(plainToInstance(CreateSplitBillDto, { title: 'Dinner', totalAmount: 1, currency: 'USD', mode: 'CUSTOM', participants: [{ email: 'member@example.com', amount: null }] }))).not.toHaveLength(0);
});
it.each(['0000-01-01', '2026-W01', '20261103', '2026-02-31', '2026-366', '2026-11-03T25:00:00Z'])('rejects unsupported reconciliation date %s', (from) => {
  expect(validateSync(plainToInstance(ReconciliationQuery, { from }))).not.toHaveLength(0);
});
