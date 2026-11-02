'use client';

import { useRef, useState } from 'react';
import { ApiError, clientFetch, isDefinitiveRejection } from '@/lib/http';
import { CURRENCIES, isFinal, Transfer, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { useTransfer } from '@/lib/use-transfer';
import { money } from '@/lib/format';
import { Alert, Button, Card, EmptyState, Field } from '@/components/ui/index';
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
  useLiveSocket({
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
      if (err instanceof ApiError && isDefinitiveRejection(err.status))
        attempt.current = null;
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || !!attempt.current;
  return (
    <div className="space-y-5">
      {(error || monitor.error) && (
        <Alert
          action={
            <Button variant="ghost" onClick={() => void reload()}>
              Спробувати ще раз
            </Button>
          }
        >
          {error || monitor.error}
        </Alert>
      )}
      {wallets.length === 0 && (
        <EmptyState
          title="Спершу відкрийте гаманець"
          description="Для переказу потрібен гаманець із доступними коштами."
          action={
            <a className="button-primary" href="/wallets">
              Відкрити й поповнити гаманець
            </a>
          }
        />
      )}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <h2>Деталі переказу</h2>
          <p className="muted mb-6 mt-2">
            Оберіть гаманець і вкажіть email отримувача.
          </p>
          <form onSubmit={submit}>
            <fieldset disabled={locked} className="grid gap-5 border-0 p-0">
              <Field id="sender-wallet" label="Гаманець відправника">
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
                        {w.currency} · доступно {money(w.available)}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                id="recipient-email"
                label="Email отримувача"
                help="Отримувач має бути зареєстрований у P2P Ledger."
              >
                <input
                  name="email"
                  type="email"
                  placeholder="friend@example.com"
                  required
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-2">
                <Field
                  id="transfer-amount"
                  label={`Сума (${wallet?.currency ?? 'валюта гаманця'})`}
                >
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    placeholder="0.00"
                    required
                  />
                </Field>
                <Field id="recipient-currency" label="Валюта отримувача">
                  <select
                    name="toCurrency"
                    defaultValue={wallet?.currency ?? 'USD'}
                    key={wallet?.currency}
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </fieldset>
            {!monitor.transfer && (
              <Button
                className="mt-6 w-full"
                loading={busy}
                disabled={
                  busy || (!attempt.current && (!wallet || wallet.frozen))
                }
              >
                {busy
                  ? 'Надсилання…'
                  : attempt.current
                    ? 'Повторити той самий переказ'
                    : 'Переказати'}
              </Button>
            )}
          </form>
          {attempt.current && !monitor.transfer && (
            <p className="muted mt-4">
              Параметри збережено для безпечного повтору цього запиту.
            </p>
          )}
        </Card>
        <div className="space-y-4">
          {monitor.transfer ? (
            <TransferProgress transfer={monitor.transfer} />
          ) : (
            <Card className="flex min-h-80 flex-col justify-center">
              <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                >
                  <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4 4-4-4 4-4" />
                </svg>
              </div>
              <h2>Кожен крок на виду</h2>
              <p className="muted mt-3">
                Після надсилання тут з’явиться живий статус переказу: від
                перевірки до зарахування коштів.
              </p>
              <div className="mt-6 grid grid-cols-7 gap-2" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className="h-1.5 rounded-full bg-line" />
                ))}
              </div>
            </Card>
          )}
          {monitor.transfer && isFinal(monitor.transfer) && (
            <Button
              className="w-full"
              variant="secondary"
              onClick={() => {
                attempt.current = null;
                monitor.track(null);
                void reload();
              }}
            >
              Новий переказ
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
