'use client';

import { useRef, useState } from 'react';
import { ApiError, clientFetch, isDefinitiveRejection } from '@/lib/http';
import { CURRENCIES, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { LiveStatus } from '@/components/live-status';

export function Wallets({
  initial,
  initialError,
}: {
  initial: Wallet[];
  initialError: string | null;
}) {
  const [wallets, setWallets] = useState(initial);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const revision = useRef(0);
  const attempt = useRef<{ key: string; path: string; body: string } | null>(
    null,
  );
  async function reload() {
    const request = ++revision.current;
    try {
      const values = await clientFetch<Wallet[]>('/wallets');
      if (request === revision.current) {
        setWallets(values);
        setError(null);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    }
  }
  const status = useLiveSocket({
    onConnect: reload,
    onWallet: (value) => {
      revision.current++;
      setWallets((old) =>
        old.map((w) => (w.id === value.walletId ? { ...w, ...value } : w)),
      );
      void reload();
    },
  });
  async function mutate(path: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError(null);
    attempt.current ??= {
      key: crypto.randomUUID(),
      path,
      body: JSON.stringify(body),
    };
    try {
      const saved = attempt.current;
      await clientFetch(saved.path, {
        method: 'POST',
        headers: { 'Idempotency-Key': saved.key },
        body: saved.body,
      });
      attempt.current = null;
      await reload();
    } catch (err) {
      if (err instanceof ApiError && isDefinitiveRejection(err.status))
        attempt.current = null;
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LiveStatus status={status} />
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <button type="button" onClick={() => void reload()}>
        Оновити
      </button>
      {!error && wallets.length === 0 && <p>Гаманців поки немає.</p>}
      <ul>
        {wallets.map((wallet) => (
          <li key={wallet.id} style={{ margin: '20px 0' }}>
            <strong>
              {wallet.currency}: {wallet.balance}
            </strong>
            <p>
              Доступно: {wallet.available} · У резерві: {wallet.held}{' '}
              {wallet.frozen && '· Заморожено'}
            </p>
            <small>ID: {wallet.id}</small>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void mutate(`/wallets/${wallet.id}/deposit`, {
                  amount: Number(data.get('amount')),
                });
              }}
            >
              <fieldset
                disabled={busy || !!attempt.current || wallet.frozen}
                style={{ border: 0, padding: '8px 0' }}
              >
                <label>
                  Сума поповнення{' '}
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    required
                  />
                </label>{' '}
                <button>Поповнити</button>
              </fieldset>
            </form>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void mutate('/wallets', {
            currency: new FormData(event.currentTarget).get('currency'),
          });
        }}
      >
        <fieldset
          disabled={busy || !!attempt.current}
          style={{ border: 0, padding: 0 }}
        >
          <label>
            Валюта{' '}
            <select name="currency">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>{' '}
          <button>Відкрити гаманець</button>
        </fieldset>
      </form>
      {attempt.current && !busy && (
        <button onClick={() => void mutate('', {})}>
          Повторити попередній запит
        </button>
      )}
    </>
  );
}
