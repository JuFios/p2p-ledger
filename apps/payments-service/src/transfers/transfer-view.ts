import { formatMinor } from '../common/money';
import { Transfer } from './entities/transfer.entity';

// Публічне подання переказу: суми рядками "0.00", як баланси в ledger.
export function toTransferView(transfer: Transfer) {
  return {
    id: transfer.id,
    status: transfer.status,
    step: transfer.step,
    fromWalletId: transfer.fromWalletId,
    senderEmail: transfer.senderEmail,
    recipientEmail: transfer.recipientEmail,
    amount: formatMinor(BigInt(transfer.amountMinor)),
    currency: transfer.currency,
    toAmount:
      transfer.toAmountMinor === null
        ? null
        : formatMinor(BigInt(transfer.toAmountMinor)),
    toCurrency: transfer.toCurrency,
    fxRate: transfer.fxRate,
    failureReason: transfer.failureReason,
    createdAt: transfer.createdAt,
    updatedAt: transfer.updatedAt,
  };
}

export type TransferView = ReturnType<typeof toTransferView>;
