import { formatMinor } from '../common/money';
import { SplitBill } from './entities/split-bill.entity';
import { aggregateBillStatus } from './split-math';

// Публічне подання рахунку: суми рядками "0.00", статус виводиться з часток.
export function toSplitBillView(bill: SplitBill) {
  const shares = [...bill.shares].sort((a, b) => a.position - b.position);
  return {
    id: bill.id,
    title: bill.title,
    creatorEmail: bill.creatorEmail,
    totalAmount: formatMinor(BigInt(bill.totalMinor)),
    currency: bill.currency,
    mode: bill.mode,
    dueAt: bill.dueAt,
    status: aggregateBillStatus(shares),
    shares: shares.map((share) => ({
      id: share.id,
      participantEmail: share.participantEmail,
      amount: formatMinor(BigInt(share.amountMinor)),
      status: share.status,
    })),
    createdAt: bill.createdAt,
  };
}

export type SplitBillView = ReturnType<typeof toSplitBillView>;
