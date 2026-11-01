'use client';

import { useRef, useState } from 'react';
import { ApiError, clientFetch } from '@/lib/http';
import { CURRENCIES, isFinal, Transfer, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { useTransfer } from '@/lib/use-transfer';
import { LiveStatus } from '@/components/live-status';
import { TransferProgress } from '@/components/transfer-progress';

export function TransferForm({
  initialWallets,
  initialError,
}: {
  initialWallets: Wallet[];
  initialError: string | null;
}) {
  const [wallets, setWallets] = useState(initialWallets);
  const [walletId, setWalletId] = useState(
    initialWallets.find((w) => !w.frozen)?.id ?? '',
  );
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ key: string; body: string } | null>(null);
  const monitor = useTransfer();
  const wallet = wallets.find((w) => w.id === walletId);
  async function reload() {
    try {
      const values = await clientFetch<Wallet[]>('/wallets');
      setWallets(values);
      setWalletId((old) => old || values.find((w) => !w.frozen)?.id || '');
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
    await monitor.refresh();
  }
  const status = useLiveSocket({
    onConnect: reload,
    onTransfer: monitor.update,
    onWallet: () => void reload(),
  });
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!attempt.current) {
      if (!wallet) return;
      const data = new FormData(event.currentTarget);
      attempt.current = {
        key: crypto.randomUUID(),
        body: JSON.stringify({
          fromWalletId: wallet.id,
          currency: wallet.currency,
          toWalletIdentifier: String(data.get('email')).trim(),
          amount: Number(data.get('amount')),
          toCurrency: data.get('toCurrency'),
        }),
      };
    }
    setBusy(true);
    setError(null);
    try {
      const saved = attempt.current;
      const value = await clientFetch<Transfer>('/transfers', {
        method: 'POST',
        headers: { 'Idempotency-Key': saved.key },
        body: saved.body,
      });
      monitor.track(value);
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
  const locked = busy || !!attempt.current;
  return (
    <>
      <LiveStatus status={status} />
      {(error || monitor.error) && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error || monitor.error}
        </p>
      )}
      {wallets.length === 0 && (
        <p>
          Спершу <a href="/wallets">відкрийте й поповніть гаманець</a>.
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={locked}
          style={{ border: 0, padding: 0, display: 'grid', gap: 12 }}
        >
          <label>
            Гаманець відправника{' '}
            <select
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              required
            >
              <option value="" disabled>
                Оберіть гаманець
              </option>
              {wallets
                .filter((w) => !w.frozen)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.currency} · доступно {w.available}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Email отримувача <input name="email" type="email" required />
          </label>
          <label>
            Сума ({wallet?.currency ?? 'валюта гаманця'}){' '}
            <input
              name="amount"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </label>
          <label>
            Валюта отримувача{' '}
            <select
              name="toCurrency"
              defaultValue={wallet?.currency ?? 'USD'}
              key={wallet?.currency}
            >
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </fieldset>
        {!monitor.transfer && (
          <button
            disabled={busy || (!attempt.current && (!wallet || wallet.frozen))}
            style={{ marginTop: 16 }}
          >
            {busy
              ? 'Надсилання…'
              : attempt.current
                ? 'Повторити той самий переказ'
                : 'Переказати'}
          </button>
        )}
      </form>
      {monitor.transfer && <TransferProgress transfer={monitor.transfer} />}
      {monitor.transfer && isFinal(monitor.transfer) && (
        <button
          onClick={() => {
            attempt.current = null;
            monitor.track(null);
            void reload();
          }}
        >
          Новий переказ
        </button>
      )}
    </>
  );
}
