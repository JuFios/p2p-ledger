import { ShareStatus } from './entities/split-share.entity';

export type BillStatus = 'PENDING' | 'PARTIALLY_PAID' | 'SETTLED';

// Порівну: залишок мінорних одиниць (копійок) дістається першому учаснику.
// Кожна частка має бути ≥ 1 мінорної одиниці, інакше розділити не можна → null.
export function splitEqually(totalMinor: bigint, count: number): bigint[] | null {
  if (count < 1) return null;
  const n = BigInt(count);
  const base = totalMinor / n;
  if (base < 1n) return null;
  const shares = Array<bigint>(count).fill(base);
  shares[0] += totalMinor - base * n;
  return shares;
}

// Статус рахунку з часток: усі PAID → SETTLED, хоч одна PAID → PARTIALLY_PAID.
// ACCEPTED і PAYING статус рахунку не змінюють — гроші ще не надійшли.
export function aggregateBillStatus(shares: { status: ShareStatus }[]): BillStatus {
  const paid = shares.filter((share) => share.status === 'PAID').length;
  if (paid === 0) return 'PENDING';
  return paid === shares.length ? 'SETTLED' : 'PARTIALLY_PAID';
}
