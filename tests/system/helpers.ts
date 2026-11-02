import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

export type Currency = 'USD' | 'EUR' | 'UAH';
export interface User {
  email: string;
  token: string;
}
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
  status: string;
  step: string;
  amount: string;
  toAmount: string | null;
  currency: Currency;
  toCurrency: Currency;
  fxRate: string | null;
  failureReason: string | null;
}
export interface Posting {
  account: string;
  currency: Currency;
  direction: 'DEBIT' | 'CREDIT';
  amountMinor: string;
}
export interface LedgerEvent {
  eventId: string;
  globalPosition: string;
  type: string;
  metadata: { transferId?: string };
  payload: { postings?: Posting[]; reason?: string };
}
export interface Activity {
  type: string;
  payload: { transferId?: string };
}

const baseUrl = process.env.BFF_URL ?? 'http://localhost:3004';

export async function api<T>(
  path: string,
  token?: string,
  body?: unknown,
  key?: string,
  statuses = body === undefined ? [200] : [200, 201],
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json();
  assert(
    statuses.includes(response.status),
    `${path}: HTTP ${response.status}, expected ${statuses.join('/')}`,
  );
  return { status: response.status, body: result as T };
}

export async function user(): Promise<User> {
  const email = `system-${randomUUID()}@example.com`;
  const result = await api<{ accessToken: string }>(
    '/auth/register',
    undefined,
    {
      email,
      password: 'System-test-password-123!',
    },
    undefined,
    [201],
  );
  return { email, token: result.body.accessToken };
}

export async function admin(): Promise<string> {
  const result = await api<{ accessToken: string }>(
    '/auth/login',
    undefined,
    {
      email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
      password: process.env.ADMIN_PASSWORD ?? 'change-me-admin',
    },
    undefined,
    [201],
  );
  return result.body.accessToken;
}

export async function wallet(
  owner: User,
  currency: Currency,
  amount = 0,
): Promise<Wallet> {
  const result = await api<Wallet>('/wallets', owner.token, { currency });
  if (amount > 0) await money(owner, result.body.id, 'deposit', amount);
  return readWallet(owner, result.body.id);
}

export async function readWallet(owner: User, id: string): Promise<Wallet> {
  return (await api<Wallet>(`/wallets/${id}`, owner.token)).body;
}

export async function money(
  owner: User,
  id: string,
  type: 'deposit' | 'withdraw',
  amount: number,
) {
  return api<Wallet>(
    `/wallets/${id}/${type}`,
    owner.token,
    { amount },
    randomUUID(),
  );
}

export function send(
  owner: User,
  from: Wallet,
  recipient: User,
  amount: number,
  toCurrency: Currency = from.currency,
  key = randomUUID(),
) {
  return api<Transfer>(
    '/transfers',
    owner.token,
    {
      fromWalletId: from.id,
      toWalletIdentifier: recipient.email,
      amount,
      currency: from.currency,
      toCurrency,
    },
    key,
    [200, 202],
  );
}

export async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  label: string,
  timeout = 20000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T;
  do {
    last = await read();
    if (accept(last)) return last;
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(`${label}: timeout; last=${JSON.stringify(last!)}`);
}

export function terminal(owner: User, id: string): Promise<Transfer> {
  return eventually(
    async () => (await api<Transfer>(`/transfers/${id}`, owner.token)).body,
    (t) => t.status === 'COMPLETED' || t.status === 'FAILED',
    `transfer ${id}`,
    90000,
  );
}

export async function events(
  token: string,
  id: string,
): Promise<LedgerEvent[]> {
  return (await api<LedgerEvent[]>(`/admin/wallets/${id}/events`, token)).body;
}

export function minor(value: string): bigint {
  assert.match(value, /^\d+\.\d{2}$/);
  return BigInt(value.replace('.', ''));
}

export function assertBalance(w: Wallet, expected: bigint) {
  assert.equal(minor(w.balance), expected);
  assert.equal(minor(w.available), expected);
  assert.equal(w.held, '0.00');
}

export function assertEventBalances(log: LedgerEvent[], w: Wallet) {
  let available = 0n;
  let held = 0n;
  let position = 0n;
  for (const event of log) {
    assert(BigInt(event.globalPosition) > position, 'event order');
    position = BigInt(event.globalPosition);
    if (
      [
        'MoneyDeposited',
        'MoneyWithdrawn',
        'HoldPlaced',
        'HoldReleased',
        'TransferCompleted',
      ].includes(event.type)
    ) {
      assert(
        (event.payload.postings?.length ?? 0) >= 2,
        `missing postings ${event.eventId}`,
      );
    }
    const totals = new Map<string, bigint>();
    for (const p of event.payload.postings ?? []) {
      const amount = BigInt(p.amountMinor);
      assert(amount > 0n);
      assert(['CREDIT', 'DEBIT'].includes(p.direction));
      const delta = p.direction === 'CREDIT' ? amount : -amount;
      totals.set(p.currency, (totals.get(p.currency) ?? 0n) + delta);
      if (p.account === `wallet:${w.id}:available`) available += delta;
      if (p.account === `wallet:${w.id}:held`) held += delta;
    }
    for (const total of totals.values())
      assert.equal(total, 0n, `unbalanced ${event.eventId}`);
    assert(
      available >= 0n && held >= 0n,
      `negative balance after ${event.eventId}`,
    );
  }
  assert.equal(available, minor(w.available));
  assert.equal(held, minor(w.held));
}

export async function reconcile(token: string) {
  const { body } = await api<{
    ok: boolean;
    projectionMismatches: unknown[];
    perCurrency: {
      currency: string;
      debits: string;
      credits: string;
      diff: string;
    }[];
  }>('/admin/reconciliation', token);
  assert.equal(body.ok, true, JSON.stringify(body));
  assert(Array.isArray(body.projectionMismatches));
  assert.equal(body.projectionMismatches.length, 0);
  assert(body.perCurrency.length > 0);
  for (const row of body.perCurrency) {
    assert.equal(row.debits, row.credits);
    assert.equal(row.diff, '0.00');
  }
  return body;
}
