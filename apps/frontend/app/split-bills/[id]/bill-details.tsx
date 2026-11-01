'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError, clientFetch } from '@/lib/http';
import { isFinal, SplitBill, Transfer, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { useTransfer } from '@/lib/use-transfer';
import { LiveStatus } from '@/components/live-status';
import { TransferProgress } from '@/components/transfer-progress';
import { acceptShare } from '../actions';

export function BillDetails({
  initial,
  initialWallets,
  email,
  initialError,
}: {
  initial: SplitBill;
  initialWallets: Wallet[];
  email: string;
  initialError: string | null;
}) {
  const [bill, setBill] = useState(initial);
  const [wallets, setWallets] = useState(initialWallets);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; shareId: string; body: string } | null>(
    null,
  );
  const monitor = useTransfer();
  const revision = useRef(0);
  async function reload() {
    const request = ++revision.current;
    try {
      const [nextBill, nextWallets] = await Promise.all([
        clientFetch<SplitBill>(`/split-bills/${bill.id}`),
        clientFetch<Wallet[]>('/wallets'),
      ]);
      if (request === revision.current) {
        setBill(nextBill);
        setWallets(nextWallets);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    }
    await monitor.refresh();
  }
  const status = useLiveSocket({
    onConnect: reload,
    onWallet: () => void reload(),
    onActivity: () => void reload(),
    onTransfer: (value) => {
      monitor.update(value);
      void reload();
    },
  });
  const own = bill.shares.find((share) => share.participantEmail === email);
  const choices = wallets.filter(
    (wallet) => wallet.currency === bill.currency && !wallet.frozen,
  );
  const paying = bill.shares.some((share) => share.status === 'PAYING');
  useEffect(() => {
    if (!paying) return;
    let stopped = false;
    const timer = setInterval(() => {
      clientFetch<SplitBill>(`/split-bills/${bill.id}`)
        .then((value) => {
          if (!stopped) setBill(value);
        })
        .catch((err) => {
          if (!stopped) setError((err as Error).message);
        });
    }, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [bill.id, paying]);
  async function accept() {
    if (!own || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await acceptShare(bill.id, own.id);
      if (result.error) setError(result.error);
      await reload();
    } catch {
      setError(
        'Не вдалося підтвердити частку. Оновіть рахунок перед повторною спробою.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function pay(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!own || busy) return;
    attempt.current ??= {
      key: crypto.randomUUID(),
      shareId: own.id,
      body: JSON.stringify({
        fromWalletId: new FormData(event.currentTarget).get('walletId'),
      }),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = attempt.current;
      const value = await clientFetch<Transfer>(
        `/split-bills/${bill.id}/shares/${saved.shareId}/pay`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': saved.key },
          body: saved.body,
        },
      );
      monitor.track(value);
      await reload();
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.status >= 400 &&
        err.status < 500 &&
        err.status !== 408
      )
        attempt.current = null;
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>{bill.title}</h1>
      <LiveStatus status={status} />
      <p>
        {bill.totalAmount} {bill.currency} · {bill.status} · Ініціатор:{' '}
        {bill.creatorEmail}
      </p>
      {bill.dueAt && <p>Сплатити до: {bill.dueAt}</p>}
      {(error || monitor.error) && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error || monitor.error}
        </p>
      )}
      <button onClick={() => void reload()}>Оновити рахунок</button>
      <ul>
        {bill.shares.map((share) => (
          <li key={share.id}>
            {share.participantEmail}: {share.amount} {bill.currency} ·{' '}
            {share.status}
          </li>
        ))}
      </ul>
      {own?.status === 'PENDING' && (
        <button disabled={busy} onClick={() => void accept()}>
          Підтвердити свою частку
        </button>
      )}
      {own &&
        (own.status === 'ACCEPTED' ||
          (!!attempt.current && !monitor.transfer)) && (
          <form onSubmit={pay}>
            <label>
              Гаманець для оплати{' '}
              <select
                name="walletId"
                disabled={busy || !!attempt.current}
                required
              >
                {choices.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {wallet.currency} · {wallet.available}
                  </option>
                ))}
              </select>
            </label>{' '}
            <button
              disabled={
                busy ||
                (!attempt.current && !choices.length) ||
                !!monitor.transfer
              }
            >
              {attempt.current
                ? 'Повторити ту саму оплату'
                : 'Сплатити свою частку'}
            </button>
            {!choices.length && (
              <p>
                <a href="/wallets">Відкрийте гаманець у {bill.currency}</a>.
              </p>
            )}
          </form>
        )}
      {monitor.transfer && <TransferProgress transfer={monitor.transfer} />}
      {monitor.transfer && isFinal(monitor.transfer) && (
        <button
          onClick={() => {
            attempt.current = null;
            monitor.track(null);
            void reload();
          }}
        >
          Оновити результат оплати
        </button>
      )}
    </>
  );
}
