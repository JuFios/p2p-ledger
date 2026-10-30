import { Posting } from './postings';

// Поточна версія схеми payload кожного типу події. Старіші версії
// піднімаються upcaster'ами при читанні (див. upcasters.ts).
export const CURRENT_SCHEMA_VERSION: Record<string, number> = {
  WalletOpened: 1,
  MoneyDeposited: 2,
  MoneyWithdrawn: 1,
  TransferInitiated: 1,
  HoldPlaced: 1,
  HoldReleased: 1,
  TransferCompleted: 1,
  TransferFailed: 1,
  WalletFrozen: 1,
};

// Події, що рухають гроші: без збалансованих проводок їх не записуємо.
export const MONEY_EVENT_TYPES = new Set([
  'MoneyDeposited',
  'MoneyWithdrawn',
  'HoldPlaced',
  'HoldReleased',
  'TransferCompleted',
]);

export interface EventMetadata {
  operationId: string;
  actorUserId?: string;
  transferId?: string;
  traceparent?: string | null;
}

export interface DomainEvent<P = Record<string, unknown>> {
  type: string;
  schemaVersion: number;
  payload: P;
}

export interface WalletOpenedPayload {
  walletId: string;
  ownerId: string;
  currency: string;
}

export interface MoneyMovedPayload {
  walletId: string;
  currency: string;
  amountMinor: string;
  postings: Posting[];
}

export function postingsOf(payload: unknown): Posting[] {
  const postings = (payload as { postings?: Posting[] }).postings;
  return Array.isArray(postings) ? postings : [];
}
