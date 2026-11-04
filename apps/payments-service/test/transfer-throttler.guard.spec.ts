import { ExecutionContext } from '@nestjs/common';
import { SplitBillsController } from '../src/split-bills/split-bills.controller';
import { TransferThrottlerGuard } from '../src/transfers/transfer-throttler.guard';
import { TransfersController } from '../src/transfers/transfers.controller';

const guard = Object.create(TransferThrottlerGuard.prototype) as {
  getTracker(req: unknown): Promise<string>;
  generateKey(context: ExecutionContext, tracker: string, name: string): string;
};

const route = (controller: { name: string }, handler: { name: string }) =>
  ({
    getClass: () => controller,
    getHandler: () => handler,
  }) as unknown as ExecutionContext;

describe('TransferThrottlerGuard', () => {
  it('ліміт рахується за userId з JWT, а не за IP', async () => {
    await expect(
      guard.getTracker({ user: { userId: 'user-1' }, ip: '10.0.0.5' }),
    ).resolves.toBe('user-1');
  });

  it('переказ і оплата частки витрачають один ліміт користувача', () => {
    const transfer = route(
      TransfersController,
      TransfersController.prototype.create,
    );
    const pay = route(SplitBillsController, SplitBillsController.prototype.pay);
    expect(guard.generateKey(transfer, 'user-1', 'default')).toBe(
      guard.generateKey(pay, 'user-1', 'default'),
    );
    expect(guard.generateKey(transfer, 'user-1', 'default')).not.toBe(
      guard.generateKey(transfer, 'user-2', 'default'),
    );
  });
});
