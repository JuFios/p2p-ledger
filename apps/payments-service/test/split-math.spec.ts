import { aggregateBillStatus, splitEqually } from '../src/split-bills/split-math';
import { ShareStatus } from '../src/split-bills/entities/split-share.entity';

const shares = (...statuses: ShareStatus[]) =>
  statuses.map((status) => ({ status }));

describe('splitEqually', () => {
  it('ділить порівну без залишку', () => {
    expect(splitEqually(3000n, 3)).toEqual([1000n, 1000n, 1000n]);
  });

  it('залишок копійок дістається першому учаснику', () => {
    // 100.00 / 3 = 33.33 + 0.01
    expect(splitEqually(10000n, 3)).toEqual([3334n, 3333n, 3333n]);
    expect(splitEqually(1002n, 5)).toEqual([202n, 200n, 200n, 200n, 200n]);
  });

  it('сума часток завжди дорівнює загальній', () => {
    for (const [total, count] of [[1n, 1], [7n, 3], [99999n, 7], [100000000n, 13]] as const) {
      const parts = splitEqually(total, count)!;
      expect(parts).toHaveLength(count);
      expect(parts.reduce((a, b) => a + b, 0n)).toBe(total);
    }
  });

  it('менше однієї мінорної одиниці на учасника — розділити не можна', () => {
    expect(splitEqually(2n, 3)).toBeNull();
    expect(splitEqually(100n, 0)).toBeNull();
  });
});

describe('aggregateBillStatus', () => {
  it('PENDING, поки жодну частку не сплачено', () => {
    expect(aggregateBillStatus(shares('PENDING', 'PENDING'))).toBe('PENDING');
    expect(aggregateBillStatus(shares('ACCEPTED', 'PAYING'))).toBe('PENDING');
  });

  it('PARTIALLY_PAID, коли сплачено частину', () => {
    expect(aggregateBillStatus(shares('PAID', 'PENDING'))).toBe('PARTIALLY_PAID');
    expect(aggregateBillStatus(shares('PAID', 'PAYING', 'PAID'))).toBe(
      'PARTIALLY_PAID',
    );
  });

  it('SETTLED, коли сплачено всі', () => {
    expect(aggregateBillStatus(shares('PAID'))).toBe('SETTLED');
    expect(aggregateBillStatus(shares('PAID', 'PAID', 'PAID'))).toBe('SETTLED');
  });
});
