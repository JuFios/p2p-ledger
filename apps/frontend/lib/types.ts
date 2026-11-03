import { SUPPORTED_CURRENCIES as CURRENCIES, Currency } from './currencies';
export { CURRENCIES };
export type { Currency };
const TRANSFER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'AWAITING_RETRY',
  'COMPENSATING',
  'COMPLETED',
  'FAILED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
export const TRANSFER_STEPS = [
  'RISK_CHECK',
  'RESOLVE_RECIPIENT',
  'FX_QUOTE',
  'HOLD',
  'CONFIRM',
  'CAPTURE',
  'RELEASE_HOLD',
  'DONE',
] as const;
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
type RemoteState<T extends string> = T | (string & { readonly unknownState: unique symbol });

export interface Transfer {
  id: string;
  status: RemoteState<TransferStatus>;
  step: RemoteState<TransferStep>;
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
  status: RemoteState<ShareStatus>;
}
export interface SplitBill {
  id: string;
  title: string;
  creatorEmail: string;
  totalAmount: string;
  currency: Currency;
  mode: SplitMode;
  dueAt: string | null;
  status: RemoteState<BillStatus>;
  shares: SplitShare[];
}
function isKnown(value: unknown, allowed: readonly string[]) {
  return typeof value === 'string' && allowed.includes(value);
}

export function isFinal(transfer: Pick<Transfer, 'status' | 'step'>) {
  const finalStatus = transfer.status === 'COMPLETED' || transfer.status === 'FAILED';
  return finalStatus && isKnown(transfer.step, TRANSFER_STEPS);
}

export function hasKnownTransferState(transfer: Transfer) {
  const knownStatus = isKnown(transfer.status, TRANSFER_STATUSES);
  const knownStep = isKnown(transfer.step, TRANSFER_STEPS);
  return knownStatus && knownStep;
}

export function hasKnownBillState(bill: SplitBill) {
  const knownStatus = isKnown(bill.status, BILL_STATUSES);
  return knownStatus && bill.shares.every(share => isKnown(share.status, SHARE_STATUSES));
}

function remoteState(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Сервіс повернув некоректний стан. Спробуйте пізніше.');
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Сервіс повернув некоректну відповідь. Спробуйте пізніше.');
  }
  return value as Record<string, unknown>;
}

function known(value: unknown, allowed: readonly string[]) {
  if (!isKnown(value, allowed)) {
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
  remoteState(item.status);
  remoteState(item.step);
  known(item.currency, CURRENCIES);
  known(item.toCurrency, CURRENCIES);
  return item as unknown as Transfer;
}

function parseShare(value: unknown) {
  const share = record(value);
  remoteState(share.status);
  return share;
}

export function parseBill(value: unknown): SplitBill {
  const item = record(value);
  remoteState(item.status);
  known(item.mode, SPLIT_MODES);
  known(item.currency, CURRENCIES);
  parseList(parseShare)(item.shares);
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
  const validId = typeof item.transferId === 'string';
  const knownStatus = isKnown(item.status, TRANSFER_STATUSES);
  const knownStep = isKnown(item.step, TRANSFER_STEPS);
  return validId && knownStatus && knownStep;
}

function isFormattedAmount(value: unknown) {
  return typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value);
}

export function validWalletUpdate(value: unknown): value is WalletUpdate {
  if (!value || typeof value !== 'object') return false;
  const item = value as WalletUpdate;
  const validId = typeof item.walletId === 'string';
  const knownCurrency = isKnown(item.currency, CURRENCIES);
  const validAmounts = [item.balance, item.available, item.held].every(isFormattedAmount);
  return validId && knownCurrency && validAmounts;
}
