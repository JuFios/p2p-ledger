import { TransferThrottlerGuard } from '../src/transfers/transfer-throttler.guard';

describe('TransferThrottlerGuard', () => {
  it('ліміт рахується за userId з JWT, а не за IP', async () => {
    const guard = Object.create(TransferThrottlerGuard.prototype) as {
      getTracker(req: unknown): Promise<string>;
    };
    await expect(
      guard.getTracker({ user: { userId: 'user-1' }, ip: '10.0.0.5' }),
    ).resolves.toBe('user-1');
  });
});
