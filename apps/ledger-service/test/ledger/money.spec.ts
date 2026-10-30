import {
  formatMinor,
  parseMinor,
  toMinor,
} from '../../src/ledger/domain/money';

describe('money', () => {
  it.each([
    [0.29, 29n],
    [0.07, 7n],
    [19.99, 1999n],
    [150, 15000n],
    [10.1, 1010n],
    [1_000_000, 100_000_000n],
  ])('toMinor(%s) = %s без похибки float', (amount, minor) => {
    expect(toMinor(amount)).toBe(minor);
  });

  it.each([
    [0n, '0.00'],
    [5n, '0.05'],
    [15000n, '150.00'],
    [-150n, '-1.50'],
  ])('formatMinor(%s) = %s', (minor, formatted) => {
    expect(formatMinor(minor)).toBe(formatted);
  });

  it('parseMinor відхиляє суму не з двома знаками після коми', () => {
    expect(() => parseMinor('1.5')).toThrow();
    expect(() => parseMinor('1e+21')).toThrow();
  });
});
