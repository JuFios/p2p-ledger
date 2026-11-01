export const CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
export interface Wallet {
  id: string;
  currency: string;
  balance: string;
  available: string;
  held: string;
  frozen: boolean;
}
export interface Transfer {
  id: string;
  status: string;
  step: string;
  amount: string;
  currency: string;
  toAmount: string | null;
  toCurrency: string;
  recipientEmail: string;
  failureReason: string | null;
}
export interface TransferUpdate {
  transferId: string;
  status: string;
  step: string;
  failureReason?: string;
}
export interface WalletUpdate {
  walletId: string;
  currency: string;
  balance: string;
  available: string;
  held: string;
}
export const ACTIVITY_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_SENT',
  'TRANSFER_RECEIVED',
  'TRANSFER_FAILED',
  'SPLIT_BILL',
  'SPLIT_REMINDER',
] as const;
export interface Activity {
  id: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
}
export interface SplitShare {
  id: string;
  participantEmail: string;
  amount: string;
  status: string;
}
export interface SplitBill {
  id: string;
  title: string;
  creatorEmail: string;
  totalAmount: string;
  currency: string;
  mode: string;
  dueAt: string | null;
  status: string;
  shares: SplitShare[];
}
export function isFinal(transfer: Pick<Transfer, 'status'>) {
  return transfer.status === 'COMPLETED' || transfer.status === 'FAILED';
}
