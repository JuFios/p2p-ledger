import { context, propagation } from '@opentelemetry/api';
import { createHash } from 'crypto';
import { EntityManager, In } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { EventStore, NewEvent, RecordedEvent } from './event-store';
import { Balances, WalletBalanceState } from './domain/postings';
import { formatMinor } from './domain/money';
import { Operation } from './entities/operation.entity';
import { OutboxMessage } from './entities/outbox-message.entity';
import { idempotencyKeyReused } from './ledger-errors';
import { WalletBalance } from '../wallets/entities/wallet-balance.entity';

// Спільний шлях запису всіх команд ledger. Виконується в транзакції викликача
// після блокування рядків wallet_balances зачеплених гаманців.

export function hashRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

// W3C traceparent активного контексту OpenTelemetry (null, поки SDK не підключено).
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}

export function toState(balance: WalletBalance): WalletBalanceState {
  return { available: BigInt(balance.available), held: BigInt(balance.held) };
}

export function formatBalance(balance: WalletBalanceState) {
  return {
    available: formatMinor(balance.available),
    held: formatMinor(balance.held),
  };
}

// Детермінований порядок блокування (ORDER BY wallet_id) — без deadlock'ів
// між операціями, що зачіпають ті самі гаманці.
export async function lockBalances(
  manager: EntityManager,
  walletIds: string[],
): Promise<Balances> {
  const rows = await manager.find(WalletBalance, {
    where: { walletId: In([...new Set(walletIds)]) },
    order: { walletId: 'ASC' },
    lock: { mode: 'pessimistic_write' },
  });
  return Object.fromEntries(rows.map((row) => [row.walletId, toState(row)]));
}

// Повтор команди з тим самим operationId повертає збережений результат.
// Викликати після блокування гаманців: паралельний дубль чекає на коміт
// першого й бачить його запис.
export async function findCompletedOperation<T>(
  manager: EntityManager,
  operationId: string,
  request: unknown,
): Promise<T | undefined> {
  const done = await manager.findOne(Operation, { where: { operationId } });
  if (!done) {
    return undefined;
  }
  if (done.requestHash !== hashRequest(request)) {
    throw idempotencyKeyReused();
  }
  return done.result as T;
}

export interface LedgerEvent extends NewEvent {
  // Інтеграційна подія для інших сервісів (outbox), якщо потрібна.
  publish?: { payload: Record<string, unknown>; userIds: string[] };
}

export interface LedgerChange {
  streamId: string;
  events: LedgerEvent[];
  // Нові баланси зачеплених гаманців (уже перевірені викликачем).
  balances: Balances;
  operation: {
    operationId: string;
    type: string;
    request: unknown;
    result: unknown;
  };
}

// Одна транзакція: події з проводками в event store, проєкція балансів,
// інтеграційні події в outbox і запис операції.
export async function commitChange(
  manager: EntityManager,
  eventStore: EventStore,
  change: LedgerChange,
): Promise<RecordedEvent[]> {
  const version = await eventStore.streamVersion(manager, change.streamId);
  const recorded = await eventStore.append(
    manager,
    change.streamId,
    version,
    change.events,
  );
  const lastPosition = recorded[recorded.length - 1].globalPosition;
  for (const [walletId, balance] of Object.entries(change.balances)) {
    await manager.update(
      WalletBalance,
      { walletId },
      {
        available: balance.available.toString(),
        held: balance.held.toString(),
        lastPosition,
      },
    );
  }
  for (const [i, event] of change.events.entries()) {
    if (!event.publish) continue;
    await manager.insert(OutboxMessage, {
      eventId: recorded[i].eventId,
      type: event.type,
      version: 1,
      payload: event.publish.payload as QueryDeepPartialEntity<object>,
      userIds: [...new Set(event.publish.userIds)],
      traceparent: event.metadata.traceparent ?? null,
    });
  }
  await manager.insert(Operation, {
    operationId: change.operation.operationId,
    type: change.operation.type,
    requestHash: hashRequest(change.operation.request),
    result: change.operation.result as QueryDeepPartialEntity<object>,
  });
  return recorded;
}
