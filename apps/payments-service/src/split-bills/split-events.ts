import { randomUUID } from 'crypto';
import { DeepPartial } from 'typeorm';
import { formatMinor } from '../common/money';
import { currentTraceparent } from '../common/tracing';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { SplitBill } from './entities/split-bill.entity';
import { SplitShare } from './entities/split-share.entity';

// Учасники дізнаються про рахунок: userIds — усі, крім ініціатора.
export function splitBillCreated(
  bill: SplitBill,
  shares: SplitShare[],
): DeepPartial<OutboxMessage> {
  return {
    eventId: randomUUID(),
    type: 'SplitBillCreated',
    version: 1,
    payload: {
      billId: bill.id,
      title: bill.title,
      creatorUserId: bill.creatorUserId,
      creatorEmail: bill.creatorEmail,
      totalAmount: formatMinor(BigInt(bill.totalMinor)),
      currency: bill.currency,
      dueAt: bill.dueAt,
      shares: shares.map((share) => ({
        shareId: share.id,
        userId: share.participantUserId,
        amount: formatMinor(BigInt(share.amountMinor)),
      })),
    },
    userIds: shares.map((share) => share.participantUserId),
    traceparent: currentTraceparent(),
  };
}

// Нагадування про прострочену частку — лише її власнику.
export function splitShareOverdue(
  bill: SplitBill,
  share: SplitShare,
): DeepPartial<OutboxMessage> {
  return {
    eventId: randomUUID(),
    type: 'SplitShareOverdue',
    version: 1,
    payload: {
      billId: bill.id,
      shareId: share.id,
      title: bill.title,
      creatorEmail: bill.creatorEmail,
      amount: formatMinor(BigInt(share.amountMinor)),
      currency: bill.currency,
      dueAt: bill.dueAt,
    },
    userIds: [share.participantUserId],
    traceparent: currentTraceparent(),
  };
}
