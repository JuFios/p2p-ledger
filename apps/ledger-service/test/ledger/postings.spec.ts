import {
  applyPostings,
  assertBalanced,
  capturePostings,
  depositPostings,
  holdPostings,
  Posting,
  releasePostings,
  UnbalancedPostingsError,
  withdrawPostings,
} from '../../src/ledger/domain/postings';

const W = 'w-1';
const R = 'w-2';

describe('postings', () => {
  describe('кожна операція дає збалансовані проводки', () => {
    it.each<[string, Posting[]]>([
      ['deposit', depositPostings(W, 'USD', 100n)],
      ['withdraw', withdrawPostings(W, 'USD', 100n)],
      ['hold', holdPostings(W, 'USD', 100n)],
      ['release', releasePostings(W, 'USD', 100n)],
      [
        'capture в одній валюті',
        capturePostings(
          { walletId: W, currency: 'USD', amountMinor: 100n },
          { walletId: R, currency: 'USD', amountMinor: 100n },
        ),
      ],
      [
        'capture USD→EUR',
        capturePostings(
          { walletId: W, currency: 'USD', amountMinor: 1000n },
          { walletId: R, currency: 'EUR', amountMinor: 920n },
        ),
      ],
    ])('%s', (_name, postings) => {
      expect(() => assertBalanced(postings)).not.toThrow();
    });
  });

  it('міжвалютний capture проходить через клірингові рахунки system:fx', () => {
    const postings = capturePostings(
      { walletId: W, currency: 'USD', amountMinor: 1000n },
      { walletId: R, currency: 'EUR', amountMinor: 920n },
    );
    const rows = postings.map((p) => [p.account, p.direction, p.amountMinor]);
    expect(rows).toEqual([
      [`wallet:${W}:held`, 'DEBIT', '1000'],
      ['system:fx:USD', 'CREDIT', '1000'],
      ['system:fx:EUR', 'DEBIT', '920'],
      [`wallet:${R}:available`, 'CREDIT', '920'],
    ]);
  });

  describe('assertBalanced відхиляє', () => {
    const debit = (amountMinor: string, currency = 'USD'): Posting => ({
      account: 'a',
      currency,
      direction: 'DEBIT',
      amountMinor,
    });
    const credit = (amountMinor: string, currency = 'USD'): Posting => ({
      account: 'b',
      currency,
      direction: 'CREDIT',
      amountMinor,
    });

    it.each<[string, Posting[]]>([
      ['різні суми', [debit('100'), credit('99')]],
      ['лише debit', [debit('100')]],
      ['порожній список', []],
      [
        'баланс лише в сумі різних валют',
        [debit('100', 'USD'), credit('100', 'EUR')],
      ],
      ['нульову суму', [debit('0'), credit('0')]],
      ['від\'ємну суму', [debit('-5'), credit('-5')]],
    ])('%s', (_name, postings) => {
      expect(() => assertBalanced(postings)).toThrow(UnbalancedPostingsError);
    });
  });

  it('capture в одній валюті з різними сумами не будується', () => {
    expect(() =>
      capturePostings(
        { walletId: W, currency: 'USD', amountMinor: 100n },
        { walletId: R, currency: 'USD', amountMinor: 90n },
      ),
    ).toThrow(UnbalancedPostingsError);
  });

  // Баланс рахунку = Σ CREDIT − Σ DEBIT; системні рахунки не враховуються.
  it('applyPostings рахує баланси гаманців з проводок', () => {
    let balances = applyPostings({}, depositPostings(W, 'USD', 1000n));
    balances = applyPostings(balances, holdPostings(W, 'USD', 300n));
    balances = applyPostings(
      balances,
      capturePostings(
        { walletId: W, currency: 'USD', amountMinor: 300n },
        { walletId: R, currency: 'USD', amountMinor: 300n },
      ),
    );
    expect(balances).toEqual({
      [W]: { available: 700n, held: 0n },
      [R]: { available: 300n, held: 0n },
    });
  });
});
