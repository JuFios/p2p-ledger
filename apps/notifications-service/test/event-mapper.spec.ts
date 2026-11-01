import 'reflect-metadata';
import { randomUUID } from 'crypto';
import {
  IntegrationEvent,
  mapEvent,
  parseEnvelope,
} from '../src/events/event-mapper';
import { validate } from '../src/config/env.validation';

const alice = randomUUID();
const bob = randomUUID();
function event(
  type: string,
  payload: Record<string, unknown>,
  producer: IntegrationEvent['producer'] = 'ledger-service',
): IntegrationEvent {
  return {
    eventId: randomUUID(),
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    producer,
    userIds: [alice, bob],
    payload,
  };
}
const wallet = (ownerId: string) => ({
  walletId: randomUUID(),
  ownerId,
  currency: 'USD',
  amount: '10.00',
  balanceAfter: { available: '9007199254740993.29', held: '0.71' },
});

describe('Event mapping', () => {
  it.each([
    'MoneyDeposited',
    'MoneyWithdrawn',
    'TransferInitiated',
    'HoldPlaced',
    'HoldReleased',
    'TransferFailed',
  ])('maps %s to an exact wallet balance', (type) => {
    const mapped = mapEvent(event(type, wallet(alice)));
    expect(mapped.pushes).toEqual([
      {
        userId: alice,
        event: 'wallet.balance',
        payload: expect.objectContaining({
          balance: '9007199254740994.00',
          held: '0.71',
        }),
      },
    ]);
    expect(mapped.activities.map((row) => row.type)).toEqual(
      type === 'MoneyDeposited'
        ? ['DEPOSIT']
        : type === 'MoneyWithdrawn'
          ? ['WITHDRAWAL']
          : [],
    );
  });
  it('updates both wallets without duplicate transfer activity from ledger', () => {
    const mapped = mapEvent(
      event('TransferCompleted', { from: wallet(alice), to: wallet(bob) }),
    );
    expect(mapped.activities).toEqual([]);
    expect(mapped.pushes.map((push) => push.userId)).toEqual([alice, bob]);
  });
  it.each([
    'PROCESSING',
    'AWAITING_RETRY',
    'COMPENSATING',
    'COMPLETED',
    'FAILED',
  ])('maps transfer %s to the intended recipients', (status) => {
    const mapped = mapEvent(
      event(
        'TransferStatusChanged',
        {
          transferId: randomUUID(),
          senderUserId: alice,
          recipientUserId: bob,
          status,
          step: 'CONFIRM',
          failureReason: 'RECIPIENT_FROZEN',
        },
        'payments-service',
      ),
    );
    expect(mapped.pushes.map((push) => push.userId)).toEqual(
      status === 'COMPLETED' ? [alice, bob] : [alice],
    );
    expect(mapped.activities.map((row) => row.type)).toEqual(
      status === 'COMPLETED'
        ? ['TRANSFER_SENT', 'TRANSFER_RECEIVED']
        : status === 'FAILED'
          ? ['TRANSFER_FAILED']
          : [],
    );
  });
  it('does not expose other participants shares', () => {
    const mapped = mapEvent(
      event(
        'SplitBillCreated',
        {
          billId: randomUUID(),
          shares: [
            { userId: alice, amount: '1.00' },
            { userId: bob, amount: '2.00' },
          ],
        },
        'payments-service',
      ),
    );
    expect(mapped.activities[0].payload.shares).toEqual([
      { userId: alice, amount: '1.00' },
    ]);
  });
  it('rejects malformed envelopes and mismatched producers', () => {
    expect(() => parseEnvelope('{}')).toThrow();
    expect(() =>
      mapEvent(event('MoneyDeposited', wallet(alice), 'payments-service')),
    ).toThrow('Invalid producer');
  });
});

describe('Environment validation', () => {
  const valid = {
    DATABASE_HOST: 'localhost',
    DATABASE_USER: 'notifications',
    DATABASE_PASSWORD: 'notifications',
    DATABASE_NAME: 'notifications',
    REDIS_HOST: 'localhost',
    JWT_ACCESS_SECRET: 'test-secret',
  };
  it('converts numeric settings and applies defaults', () => {
    expect(validate({ ...valid, REDIS_PORT: '6380' })).toEqual(
      expect.objectContaining({ REDIS_PORT: 6380, CONSUMER_MAX_DELIVERIES: 5 }),
    );
  });
  it.each(['DATABASE_HOST', 'DATABASE_PASSWORD', 'JWT_ACCESS_SECRET'])(
    'requires %s',
    (name) => {
      expect(() => validate({ ...valid, [name]: '' })).toThrow();
    },
  );
  it.each([
    { CONSUMER_MAX_DELIVERIES: '0' },
    { CONSUMER_CLAIM_IDLE_MS: '-1' },
    { REDIS_PORT: 'abc' },
    { CORS_ORIGIN: '*' },
  ])('rejects invalid configuration %p', (invalid) => {
    expect(() => validate({ ...valid, ...invalid })).toThrow();
  });
});
