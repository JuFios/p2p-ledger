import { randomUUID } from 'crypto';
import { DeepPartial } from 'typeorm';
import { formatMinor } from '../common/money';
import { currentTraceparent } from '../common/tracing';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { Transfer } from './entities/transfer.entity';

// Рядок outbox TransferStatusChanged — на кожну зміну status/step, для
// live-прогресу переказу. Отримувач бачить переказ лише після зарахування.
export function transferStatusChanged(
  transfer: Transfer,
): DeepPartial<OutboxMessage> {
  return {
    eventId: randomUUID(),
    type: 'TransferStatusChanged',
    version: 1,
    payload: {
      transferId: transfer.id,
      senderUserId: transfer.senderUserId,
      recipientUserId: transfer.recipientUserId,
      status: transfer.status,
      step: transfer.step,
      amount: formatMinor(BigInt(transfer.amountMinor)),
      currency: transfer.currency,
      toAmount:
        transfer.toAmountMinor === null
          ? null
          : formatMinor(BigInt(transfer.toAmountMinor)),
      toCurrency: transfer.toCurrency,
      ...(transfer.failureReason
        ? { failureReason: transfer.failureReason }
        : {}),
    },
    userIds:
      transfer.status === 'COMPLETED' && transfer.recipientUserId
        ? [transfer.senderUserId, transfer.recipientUserId]
        : [transfer.senderUserId],
    traceparent: currentTraceparent(),
  };
}
