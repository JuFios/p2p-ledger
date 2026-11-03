import { isMoneyAmount, MAX_AMOUNT } from '../src/wallets/dto/is-money-amount';

it.each([
  [0, false], [-1, false], [0.001, false], [1e-7, false], [0.29, true],
  [1000000, true], [1000000.01, false], [NaN, false], [Infinity, false],
  [null, false], [undefined, false], ['1', false], [1.01, true],
])('enforces the money contract for %s', (value, accepted) => {
  expect(isMoneyAmount(value)).toBe(accepted);
});
it('keeps the public maximum compatible', () => expect(MAX_AMOUNT).toBe(1000000));
