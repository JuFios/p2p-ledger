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

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Сервіс повернув некоректну відповідь. Спробуйте пізніше.');
  }
  return value as Record<string, unknown>;
}

function known(value: unknown, allowed: readonly string[]) {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new Error('Сервіс повернув невідомий стан. Оновіть сторінку або спробуйте пізніше.');
  }
}

export function parseWallet(value: unknown): Wallet {
  const item = record(value);
  known(item.currency, CURRENCIES);
  return item as unknown as Wallet;
}

export function parseTransfer(value: unknown): Transfer {
  const item = record(value);
  known(item.status, TRANSFER_STATUSES);
  known(item.step, TRANSFER_STEPS);
  known(item.currency, CURRENCIES);
  known(item.toCurrency, CURRENCIES);
  return item as unknown as Transfer;
}

export function parseBill(value: unknown): SplitBill {
  const item = record(value);
  known(item.status, BILL_STATUSES);
  known(item.mode, SPLIT_MODES);
  known(item.currency, CURRENCIES);
  parseList(share => {
    known(record(share).status, SHARE_STATUSES);
    return share;
  })(item.shares);
  return item as unknown as SplitBill;
}

export function parseList<T>(parse: (value: unknown) => T) {
  return (value: unknown): T[] => {
    if (!Array.isArray(value)) {
      throw new Error('Сервіс повернув некоректний список. Спробуйте пізніше.');
    }
    return value.map(parse);
  };
}

export function validTransferUpdate(value: unknown): value is TransferUpdate {
  if (!value || typeof value !== 'object') return false;
  const item = value as TransferUpdate;
  return typeof item.transferId === 'string' &&
    TRANSFER_STATUSES.includes(item.status) && TRANSFER_STEPS.includes(item.step);
}

export function validWalletUpdate(value: unknown): value is WalletUpdate {
  if (!value || typeof value !== 'object') return false;
  const item = value as WalletUpdate;
  return typeof item.walletId === 'string' && CURRENCIES.includes(item.currency) &&
    [item.balance, item.available, item.held].every(amount =>
      typeof amount === 'string' && /^-?\d+\.\d{2}$/.test(amount));
}
