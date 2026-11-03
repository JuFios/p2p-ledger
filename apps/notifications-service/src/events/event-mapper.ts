import { SUPPORTED_CURRENCIES } from '../common/currencies';
import { isUUID } from 'class-validator';
import { ActivityType } from '../activity/activity.entity';

export interface IntegrationEvent {
  eventId: string;
  position?: string;
  type: string;
  version: number;
  occurredAt: string;
  producer: 'ledger-service' | 'payments-service';
  userIds: string[];
  traceparent?: string | null;
  payload: Record<string, unknown>;
}
export interface Push {
  userId: string;
  event: string;
  payload: Record<string, unknown>;
}
export interface ActivityDraft {
  userId: string;
  type: ActivityType;
  payload: Record<string, unknown>;
}
export const LEDGER_TYPES = [
  'MoneyDeposited',
  'MoneyWithdrawn',
  'TransferInitiated',
  'HoldPlaced',
  'HoldReleased',
  'TransferCompleted',
  'TransferFailed',
];
const BALANCE_NEUTRAL_EVENTS = new Set(['TransferInitiated', 'TransferFailed']);

export const PAYMENT_TYPES = [
  'TransferStatusChanged',
  'SplitBillCreated',
  'SplitShareOverdue',
];
export const KNOWN_TYPES = [...LEDGER_TYPES, ...PAYMENT_TYPES];

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid object');
  return value as Record<string, unknown>;
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !isUUID(value))
    throw new Error('Invalid UUID');
  return value;
}
function money(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value))
    throw new Error('Invalid money');
  return BigInt(value.replace('.', ''));
}
export function parseEnvelope(raw: string): IntegrationEvent {
  const event = record(JSON.parse(raw));
  uuid(event.eventId);
  if (event.position !== undefined &&
      (typeof event.position !== 'string' || !/^[1-9]\d{0,18}$/.test(event.position) ||
       BigInt(event.position) > 9223372036854775807n))
    throw new Error('Invalid event position');
  if (
    typeof event.type !== 'string' ||
    !Number.isInteger(event.version) ||
    Number(event.version) < 1 ||
    typeof event.occurredAt !== 'string' ||
    !Number.isFinite(Date.parse(event.occurredAt)) ||
    !['ledger-service', 'payments-service'].includes(String(event.producer)) ||
    !Array.isArray(event.userIds)
  )
    throw new Error('Invalid envelope');
  event.userIds.forEach(uuid);
  record(event.payload);
  return event as unknown as IntegrationEvent;
}

export function mapEvent(event: IntegrationEvent): {
  activities: ActivityDraft[];
  pushes: Push[];
} {
  const activities: ActivityDraft[] = [];
  const pushes: Push[] = [];
  const payload = event.payload;
  const users = [...new Set(event.userIds)];
  const activity = (userId: string, type: ActivityType, data = payload) => {
    if (!users.includes(userId))
      throw new Error('Activity recipient missing from userIds');
    activities.push({ userId, type, payload: data });
  };
  if (LEDGER_TYPES.includes(event.type)) {
    if (event.producer !== 'ledger-service')
      throw new Error('Invalid producer');
    // Lifecycle-події валідуються, але не створюють push: їхній знімок
    // дублює HoldPlaced/HoldReleased.
    const emitsBalance = !BALANCE_NEUTRAL_EVENTS.has(event.type);
    const wallets =
      event.type === 'TransferCompleted'
        ? [record(payload.from), record(payload.to)]
        : [payload];
    for (const wallet of wallets) {
      const ownerId = uuid(wallet.ownerId);
      if (!users.includes(ownerId))
        throw new Error('Wallet owner missing from userIds');
      const balanceAfter = record(wallet.balanceAfter);
      const total = money(balanceAfter.available) + money(balanceAfter.held);
      if (!SUPPORTED_CURRENCIES.some((currency) => currency === wallet.currency))
        throw new Error('Invalid currency');
      if (emitsBalance)
        pushes.push({
          userId: ownerId,
          event: 'wallet.balance',
          payload: {
            walletId: uuid(wallet.walletId),
            currency: wallet.currency,
            balance: `${total / 100n}.${(total % 100n).toString().padStart(2, '0')}`,
            available: balanceAfter.available,
            held: balanceAfter.held,
          },
        });
    }
    if (event.type === 'MoneyDeposited')
      activity(uuid(payload.ownerId), 'DEPOSIT');
    if (event.type === 'MoneyWithdrawn')
      activity(uuid(payload.ownerId), 'WITHDRAWAL');
  } else if (PAYMENT_TYPES.includes(event.type)) {
    if (event.producer !== 'payments-service')
      throw new Error('Invalid producer');
    if (event.type === 'TransferStatusChanged') {
      uuid(payload.transferId);
      const sender = uuid(payload.senderUserId);
      if (
        ![
          'PENDING',
          'PROCESSING',
          'AWAITING_RETRY',
          'COMPENSATING',
          'COMPLETED',
          'FAILED',
        ].includes(String(payload.status)) ||
        typeof payload.step !== 'string'
      )
        throw new Error('Invalid transfer status');
      const recipients =
        payload.status === 'COMPLETED'
          ? [sender, uuid(payload.recipientUserId)]
          : [sender];
      for (const userId of new Set(recipients)) {
        if (!users.includes(userId))
          throw new Error('Transfer recipient missing from userIds');
        pushes.push({
          userId,
          event: 'transfer.status',
          payload: {
            transferId: payload.transferId,
            status: payload.status,
            step: payload.step,
            ...(payload.failureReason
              ? { failureReason: payload.failureReason }
              : {}),
          },
        });
      }
      if (payload.status === 'COMPLETED') {
        activity(sender, 'TRANSFER_SENT');
        activity(uuid(payload.recipientUserId), 'TRANSFER_RECEIVED');
      } else if (payload.status === 'FAILED')
        activity(sender, 'TRANSFER_FAILED');
    } else {
      uuid(payload.billId);
      if (event.type === 'SplitShareOverdue') uuid(payload.shareId);
      for (const userId of users) {
        // Учасник бачить лише власну частку, без списку чужих часток.
        const data = { ...payload };
        if (event.type === 'SplitBillCreated') {
          if (!Array.isArray(payload.shares)) throw new Error('Invalid shares');
          data.shares = payload.shares.filter(
            (share) => record(share).userId === userId,
          );
        }
        activity(
          userId,
          event.type === 'SplitBillCreated' ? 'SPLIT_BILL' : 'SPLIT_REMINDER',
          data,
        );
      }
    }
  }
  return { activities, pushes };
}
