import { compareBalances } from '../../src/admin/reconciliation';

describe('compareBalances', () => {
  const state = (available: bigint, held = 0n) => ({ available, held });

  it('однакові баланси — без розбіжностей', () => {
    expect(
      compareBalances({ a: state(100n, 5n) }, { a: state(100n, 5n) }),
    ).toEqual([]);
  });

  it('повідомляє про різні суми й гаманці, яких немає з одного боку', () => {
    expect(
      compareBalances(
        { a: state(100n), b: state(1n), c: state(0n, 7n) },
        { a: state(101n), c: state(0n, 7n), d: state(0n) },
      ),
    ).toEqual([
      {
        walletId: 'a',
        rebuilt: { available: '1.00', held: '0.00' },
        projection: { available: '1.01', held: '0.00' },
      },
      { walletId: 'b', rebuilt: { available: '0.01', held: '0.00' }, projection: null },
      { walletId: 'd', rebuilt: null, projection: { available: '0.00', held: '0.00' } },
    ]);
  });

  it('розбіжність лише в held теж помічає', () => {
    expect(compareBalances({ a: state(0n, 1n) }, { a: state(0n, 0n) })).toHaveLength(1);
  });
});
