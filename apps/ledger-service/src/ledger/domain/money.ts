// Гроші в ledger — bigint у мінорних одиницях (центах).

export function parseMinor(amount: string): bigint {
  const match = /^(\d+)\.(\d{2})$/.exec(amount);
  if (!match) {
    throw new Error(`Некоректна сума: ${amount}`);
  }
  return BigInt(match[1] + match[2]);
}

// Через рядок, а не amount * 100: 0.29 * 100 = 28.999…
export function toMinor(amount: number): bigint {
  return parseMinor(amount.toFixed(2));
}

export function formatMinor(minor: bigint): string {
  const sign = minor < 0n ? '-' : '';
  const digits = (minor < 0n ? -minor : minor).toString().padStart(3, '0');
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
