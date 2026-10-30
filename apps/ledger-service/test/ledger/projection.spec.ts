import { DomainEvent } from '../../src/ledger/domain/events';
import {
  depositPostings,
  withdrawPostings,
} from '../../src/ledger/domain/postings';
import { projectBalances } from '../../src/ledger/domain/projection';
import { upcast } from '../../src/ledger/domain/upcasters';

const W = 'w-1';

// MoneyDeposited у старому форматі v1: сума рядком, без проводок.
const depositedV1: DomainEvent<unknown> = {
  type: 'MoneyDeposited',
  schemaVersion: 1,
  payload: { walletId: W, currency: 'USD', amount: '150.00' },
};

const moved = (type: string, schemaVersion: number, amountMinor: bigint) => ({
  type,
  schemaVersion,
  payload: {
    walletId: W,
    currency: 'USD',
    amountMinor: amountMinor.toString(),
    postings: (type === 'MoneyDeposited' ? depositPostings : withdrawPostings)(
      W,
      'USD',
      amountMinor,
    ),
  },
});

describe('upcast', () => {
  it('піднімає MoneyDeposited v1 → v2 з проводками', () => {
    expect(upcast(depositedV1)).toEqual(moved('MoneyDeposited', 2, 15000n));
  });

  it('поточну версію не змінює', () => {
    const event = moved('MoneyWithdrawn', 1, 100n);
    expect(upcast(event)).toEqual(event);
  });

  it('падає, якщо для старої версії немає upcaster\'а', () => {
    expect(() =>
      upcast({ type: 'MoneyDeposited', schemaVersion: 0, payload: {} }),
    ).toThrow();
  });
});

describe('projectBalances', () => {
  it('будує баланс з потоку подій, включно зі старою версією схеми', () => {
    const balances = projectBalances([
      {
        type: 'WalletOpened',
        schemaVersion: 1,
        payload: { walletId: W, ownerId: 'u-1', currency: 'USD' },
      },
      depositedV1,
      moved('MoneyDeposited', 2, 5000n),
      moved('MoneyWithdrawn', 1, 2550n),
    ]);
    expect(balances).toEqual({ [W]: { available: 17450n, held: 0n } });
  });

  it('гаманець без руху після відкриття має нульовий баланс', () => {
    expect(
      projectBalances([
        {
          type: 'WalletOpened',
          schemaVersion: 1,
          payload: { walletId: W, ownerId: 'u-1', currency: 'USD' },
        },
      ]),
    ).toEqual({ [W]: { available: 0n, held: 0n } });
  });
});
