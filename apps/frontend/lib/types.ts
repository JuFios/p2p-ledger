export const CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
export type Currency = (typeof CURRENCIES)[number];
export const TRANSFER_STATUSES = ['PENDING', 'PROCESSING', 'AWAITING_RETRY', 'COMPENSATING', 'COMPLETED', 'FAILED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_STEPS = ['RISK_CHECK', 'RESOLVE_RECIPIENT', 'FX_QUOTE', 'HOLD', 'CONFIRM', 'CAPTURE', 'RELEASE_HOLD', 'DONE'] as const;
export type TransferStep = (typeof TRANSFER_STEPS)[number];
export const SHARE_STATUSES = ['PENDING', 'ACCEPTED', 'PAYING', 'PAID'] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];
export const BILL_STATUSES = ['PENDING', 'PARTIALLY_PAID', 'SETTLED'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
export const SPLIT_MODES = ['EQUAL', 'CUSTOM'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];
export interface Wallet {
  id: string;
  currency: Currency;
  balance: string;
  available: string;
  held: string;
  frozen: boolean;
}
export interface Transfer {
  id: string;
  status: TransferStatus;
  step: TransferStep;
  amount: string;
  currency: Currency;
  toAmount: string | null;
  toCurrency: Currency;
  recipientEmail: string;
  failureReason: string | null;
}
export interface TransferUpdate {
  transferId: string;
  status: TransferStatus;
  step: TransferStep;
  failureReason?: string;
}
export interface WalletUpdate {
  walletId: string;
  currency: Currency;
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
  status: ShareStatus;
}
export interface SplitBill {
  id: string;
  title: string;
  creatorEmail: string;
  totalAmount: string;
  currency: Currency;
  mode: SplitMode;
  dueAt: string | null;
  status: BillStatus;
  shares: SplitShare[];
}
export function isFinal(transfer: Pick<Transfer, 'status'>) {
  return transfer.status === 'COMPLETED' || transfer.status === 'FAILED';
}

function known(value: unknown, allowed: readonly string[]) {
  if (value !== undefined && (typeof value !== 'string' || !allowed.includes(value)))
    throw new Error('Сервіс повернув невідомий стан. Оновіть сторінку або спробуйте пізніше.');
}
// Невідома версія контракту не запускає дії зі станом, який UI не розуміє.
export function validateApiState(path: string, value: unknown): void {
  if (/^\/split-bills\/[^/]+\/shares\/[^/]+\/pay$/.test(path)) {
    validateApiState('/transfers', value);
    return;
  }
  if (Array.isArray(value)) { value.forEach(item => validateApiState(path, item)); return; }
  if (!value || typeof value !== 'object') return;
  const item = value as Record<string, unknown>;
  if (path.startsWith('/wallets')) known(item.currency, CURRENCIES);
  if (path.startsWith('/transfers')) {
    known(item.status, TRANSFER_STATUSES); known(item.step, TRANSFER_STEPS);
    known(item.currency, CURRENCIES); known(item.toCurrency, CURRENCIES);
  }
  if (path.startsWith('/split-bills')) {
    known(item.status, BILL_STATUSES); known(item.mode, SPLIT_MODES); known(item.currency, CURRENCIES);
    if (Array.isArray(item.shares)) for (const share of item.shares) known(share.status, SHARE_STATUSES);
  }
}
export function validTransferUpdate(value: TransferUpdate) {
  return TRANSFER_STATUSES.includes(value.status) && TRANSFER_STEPS.includes(value.step);
}
