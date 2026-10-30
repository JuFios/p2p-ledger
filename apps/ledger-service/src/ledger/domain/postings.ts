export type Direction = 'DEBIT' | 'CREDIT';

export interface Posting {
  account: string;
  currency: string;
  direction: Direction;
  amountMinor: string;
}

export const accounts = {
  available: (walletId: string) => `wallet:${walletId}:available`,
  held: (walletId: string) => `wallet:${walletId}:held`,
  // Зовнішній світ: поповнення й виведення (мок банківських рейок).
  external: (currency: string) => `system:external:${currency}`,
  // Клірингові рахунки конвертації валют.
  fx: (currency: string) => `system:fx:${currency}`,
};

export class UnbalancedPostingsError extends Error {}

// Одна пара проводок: debit одного рахунку = credit іншого.
function move(
  from: string,
  to: string,
  currency: string,
  amountMinor: bigint,
): Posting[] {
  if (amountMinor <= 0n) {
    throw new UnbalancedPostingsError('Сума проводки має бути додатною');
  }
  const amount = amountMinor.toString();
  return [
    { account: from, currency, direction: 'DEBIT', amountMinor: amount },
    { account: to, currency, direction: 'CREDIT', amountMinor: amount },
  ];
}

export const depositPostings = (
  walletId: string,
  currency: string,
  amountMinor: bigint,
) =>
  move(
    accounts.external(currency),
    accounts.available(walletId),
    currency,
    amountMinor,
  );

export const withdrawPostings = (
  walletId: string,
  currency: string,
  amountMinor: bigint,
) =>
  move(
    accounts.available(walletId),
    accounts.external(currency),
    currency,
    amountMinor,
  );

export const holdPostings = (
  walletId: string,
  currency: string,
  amountMinor: bigint,
) =>
  move(
    accounts.available(walletId),
    accounts.held(walletId),
    currency,
    amountMinor,
  );

export const releasePostings = (
  walletId: string,
  currency: string,
  amountMinor: bigint,
) =>
  move(
    accounts.held(walletId),
    accounts.available(walletId),
    currency,
    amountMinor,
  );

export interface CaptureLeg {
  walletId: string;
  currency: string;
  amountMinor: bigint;
}

// Захоплення холду: списання з held відправника, зарахування отримувачу.
// Між валютами гроші проходять через клірингові рахунки system:fx:*,
// тож кожна валюта окремо лишається збалансованою.
export function capturePostings(from: CaptureLeg, to: CaptureLeg): Posting[] {
  if (from.currency === to.currency) {
    if (from.amountMinor !== to.amountMinor) {
      throw new UnbalancedPostingsError('Суми в одній валюті мають збігатися');
    }
    return move(
      accounts.held(from.walletId),
      accounts.available(to.walletId),
      from.currency,
      from.amountMinor,
    );
  }
  return [
    ...move(
      accounts.held(from.walletId),
      accounts.fx(from.currency),
      from.currency,
      from.amountMinor,
    ),
    ...move(
      accounts.fx(to.currency),
      accounts.available(to.walletId),
      to.currency,
      to.amountMinor,
    ),
  ];
}

// Інваріант кожної операції: для кожної валюти Σ DEBIT = Σ CREDIT.
export function assertBalanced(postings: Posting[]): void {
  if (postings.length === 0) {
    throw new UnbalancedPostingsError('Операція без проводок');
  }
  const totals = new Map<string, bigint>();
  for (const p of postings) {
    const amount = BigInt(p.amountMinor);
    if (amount <= 0n) {
      throw new UnbalancedPostingsError('Сума проводки має бути додатною');
    }
    const delta = p.direction === 'DEBIT' ? amount : -amount;
    totals.set(p.currency, (totals.get(p.currency) ?? 0n) + delta);
  }
  for (const [currency, diff] of totals) {
    if (diff !== 0n) {
      throw new UnbalancedPostingsError(
        `Проводки не збалансовані у ${currency}: різниця ${diff}`,
      );
    }
  }
}

export interface WalletBalanceState {
  available: bigint;
  held: bigint;
}

export type Balances = Record<string, WalletBalanceState>;

const WALLET_ACCOUNT = /^wallet:(.+):(available|held)$/;

// Баланс рахунку гаманця = Σ CREDIT − Σ DEBIT. Системні рахунки в проєкцію
// гаманців не входять. Перевірку на від'ємний баланс робить викликач.
export function applyPostings(
  balances: Balances,
  postings: Posting[],
): Balances {
  const next: Balances = { ...balances };
  for (const p of postings) {
    const match = WALLET_ACCOUNT.exec(p.account);
    if (!match) continue;
    const [, walletId, bucket] = match as unknown as [
      string,
      string,
      keyof WalletBalanceState,
    ];
    const current = next[walletId] ?? { available: 0n, held: 0n };
    const amount = BigInt(p.amountMinor);
    next[walletId] = {
      ...current,
      [bucket]: current[bucket] + (p.direction === 'CREDIT' ? amount : -amount),
    };
  }
  return next;
}
