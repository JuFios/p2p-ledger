'use client';

import { MAX_AMOUNT } from '@/lib/validation';

import { useEffect, useRef, useState } from 'react';
import {
  attemptScope,
  clearAttempt,
  readAttempt,
  writeAttempt,
} from '@/lib/attempt-storage';
import { ApiError, clientFetch, isDefinitiveRejection } from '@/lib/http';
import { parseList, parseWallet, CURRENCIES, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
} from '@/components/ui/index';
import { CopyId } from '@/components/ui/copy-id';
import { money } from '@/lib/format';

export function Wallets({
  userId,
  initial,
  initialError,
}: {
  userId: string;
  initial: Wallet[];
  initialError: string | null;
}) {
  const scope = attemptScope(userId, 'wallets');
  const [wallets, setWallets] = useState(initial);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [, restored] = useState(0);
  const revision = useRef(0);
  const [changed, setChanged] = useState<string | null>(null);
  const attempt = useRef<{ key: string; path: string; body: string } | null>(
    null,
  );
  useEffect(() => {
    const pending = readAttempt<{ key: string; path: string; body: string }>(
      scope,
    );
    if (
      pending &&
      typeof pending.path === 'string' &&
      typeof pending.body === 'string'
    ) {
      attempt.current = pending;
      restored((value) => value + 1);
    }
  }, [scope]);
  async function reload() {
    const request = ++revision.current;
    try {
      const values = await clientFetch<Wallet[]>('/wallets', undefined, parseList(parseWallet));
      if (request === revision.current) {
        setWallets(values);
        setError(null);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    }
  }
  useLiveSocket({
    onConnect: reload,
    onWallet: (value) => {
      revision.current++;
      setChanged(`${value.walletId}:${Date.now()}`);
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
    writeAttempt(scope, attempt.current);
    try {
      const saved = attempt.current;
      await clientFetch(saved.path, {
        method: 'POST',
        headers: { 'Idempotency-Key': saved.key },
        body: saved.body,
      });
      attempt.current = null;
      clearAttempt(scope);
      await reload();
    } catch (err) {
      if (err instanceof ApiError && isDefinitiveRejection(err.status)) {
        attempt.current = null;
        clearAttempt(scope);
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-6">
      {error && (
        <Alert
          action={
            <Button variant="ghost" onClick={() => void reload()}>
              Спробувати ще раз
            </Button>
          }
        >
          {error}
        </Alert>
      )}
      {!error && wallets.length === 0 && (
        <EmptyState
          title="Гаманців поки немає"
          description="Відкрийте гаманець у потрібній валюті, щоб почати."
          action={
            <a className="button-primary" href="#open-wallet">
              Відкрити перший гаманець
            </a>
          }
        />
      )}
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {wallets.map((wallet) => (
          <Card key={wallet.id} className="flex min-w-0 flex-col">
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-lg font-medium text-accent">
                {
                  ({ USD: '$', EUR: '€', UAH: '₴' } as Record<string, string>)[
                    wallet.currency
                  ]
                }
              </span>
              <Badge tone={wallet.frozen ? 'caution' : 'neutral'}>
                {wallet.frozen ? 'Заморожено' : wallet.currency}
              </Badge>
            </div>
            <p className="muted mb-1 mt-6">Доступно</p>
            <div
              key={changed?.startsWith(wallet.id) ? changed : wallet.id}
              className={`-mx-2 rounded-lg px-2 py-1 ${changed?.startsWith(wallet.id) ? 'balance-flash' : ''}`}
            >
              <p className="amount break-words text-3xl font-semibold">
                {money(wallet.available)}{' '}
                <span className="text-sm font-medium text-muted">
                  {wallet.currency}
                </span>
              </p>
            </div>
            <p className="muted mt-2">
              У резерві: <span className="amount">{money(wallet.held)}</span>
            </p>
            <div className="mt-2">
              <CopyId value={wallet.id} />
            </div>
            <form
              className="mt-5 border-t pt-5"
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                const operation = (event.nativeEvent as SubmitEvent)
                  .submitter as HTMLButtonElement | null;
                void mutate(
                  `/wallets/${wallet.id}/${operation?.value === 'withdraw' ? 'withdraw' : 'deposit'}`,
                  { amount: Number(data.get('amount')) },
                );
              }}
            >
              <fieldset
                disabled={busy || !!attempt.current || wallet.frozen}
                className="space-y-3 border-0 p-0"
              >
                <Field
                  id={`amount-${wallet.id}`}
                  label="Сума операції"
                  help={`Від 0.01 до ${money(String(MAX_AMOUNT))}, до двох знаків після крапки.`}
                >
                  <input
                    name="amount"
                    type="number"
                    min="0.01"
                    max={MAX_AMOUNT}
                    step="0.01"
                    required
                    placeholder="0.00"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="submit"
                    name="operation"
                    value="deposit"
                    loading={busy}
                  >
                    Поповнити
                  </Button>
                  <Button
                    type="submit"
                    name="operation"
                    value="withdraw"
                    variant="secondary"
                    disabled={busy}
                  >
                    Зняти
                  </Button>
                </div>
              </fieldset>
            </form>
          </Card>
        ))}
      </div>
      <Card id="open-wallet">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2>Ще одна валюта?</h2>
            <p className="muted mt-1">
              Один гаманець на кожну валюту: USD, EUR та UAH.
            </p>
          </div>
          <Button variant="ghost" onClick={() => void reload()}>
            Оновити
          </Button>
        </div>
        <form
          className="mt-5"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate('/wallets', {
              currency: new FormData(event.currentTarget).get('currency'),
            });
          }}
        >
          <fieldset
            disabled={busy || !!attempt.current}
            className="flex flex-col items-stretch gap-3 border-0 p-0 sm:flex-row sm:items-end"
          >
            <div className="sm:w-44">
              <Field id="open-currency" label="Валюта">
                <select name="currency">
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Button loading={busy}>Відкрити гаманець</Button>
          </fieldset>
        </form>
      </Card>
      {attempt.current && !busy && (
        <Alert
          tone="caution"
          action={
            <Button variant="secondary" onClick={() => void mutate('', {})}>
              Повторити попередній запит
            </Button>
          }
        >
          Результат операції ще невідомий. Повторіть збережений запит.
        </Alert>
      )}
    </div>
  );
}
