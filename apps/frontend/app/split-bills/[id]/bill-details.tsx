'use client';

import { useEffect, useRef, useState } from 'react';
import {
  attemptScope,
  clearAttempt,
  readAttempt,
  writeAttempt,
} from '@/lib/attempt-storage';
import { ApiError, clientFetch, isDefinitiveRejection } from '@/lib/http';
import { isFinal, SplitBill, Transfer, Wallet } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { useTransfer } from '@/lib/use-transfer';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  PageHeading,
} from '@/components/ui/index';
import { CopyId } from '@/components/ui/copy-id';
import { dateLabel, money, statusLabels } from '@/lib/format';
import { TransferProgress } from '@/components/transfer-progress';
import { acceptShare } from '../actions';

export function BillDetails({
  userId,
  initial,
  initialWallets,
  email,
  initialError,
}: {
  userId: string;
  initial: SplitBill;
  initialWallets: Wallet[];
  email: string;
  initialError: string | null;
}) {
  const [bill, setBill] = useState(initial);
  const [wallets, setWallets] = useState(initialWallets);
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  const [restoredWallet, setRestoredWallet] = useState<string | null>(null);
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
        setError(null);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    }
    await monitor.refresh();
  }
  useLiveSocket({
    onConnect: reload,
    onWallet: () => void reload(),
    onActivity: () => void reload(),
    onTransfer: (value) => {
      monitor.update(value);
      void reload();
    },
  });
  const own = bill.shares.find((share) => share.participantEmail === email);
  const scope = attemptScope(userId, `split-pay:${bill.id}:${own?.id ?? ''}`);
  useEffect(() => {
    if (!own) return;
    if (own.status === 'PAID') {
      clearAttempt(scope);
      attempt.current = null;
      setRestoredWallet(null);
      return;
    }
    if (attempt.current) return;
    const pending = readAttempt<{ key: string; shareId: string; body: string }>(
      scope,
    );
    if (!pending) return;
    try {
      if (pending.shareId !== own.id || typeof pending.body !== 'string')
        throw new Error();
      const body = JSON.parse(pending.body);
      if (typeof body.fromWalletId !== 'string') throw new Error();
      attempt.current = pending;
      setRestoredWallet(body.fromWalletId);
    } catch {
      clearAttempt(scope);
    }
  }, [scope, own]);
  useEffect(() => {
    if (monitor.transfer && isFinal(monitor.transfer)) clearAttempt(scope);
  }, [monitor.transfer, scope]);
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
      writeAttempt(scope, saved);
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
      if (err instanceof ApiError && isDefinitiveRejection(err.status)) {
        attempt.current = null;
        clearAttempt(scope);
        setRestoredWallet(null);
      }
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const paidCount = bill.shares.filter(
    (share) => share.status === 'PAID',
  ).length;
  const overdue =
    !!bill.dueAt &&
    new Date(bill.dueAt).getTime() < Date.now() &&
    bill.status !== 'SETTLED';
  return (
    <div className="space-y-6">
      <a href="/split-bills" className="text-link text-sm">
        ← Спільні рахунки
      </a>
      <PageHeading
        title={bill.title}
        description={`Ініціатор: ${bill.creatorEmail}`}
        action={
          <Button variant="secondary" onClick={() => void reload()}>
            Оновити рахунок
          </Button>
        }
      />
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
      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="muted">Загальна сума</p>
                <p className="amount mt-2 text-3xl font-semibold">
                  {money(bill.totalAmount)}{' '}
                  <span className="text-base text-muted">{bill.currency}</span>
                </p>
              </div>
              <Badge tone={bill.status === 'SETTLED' ? 'positive' : 'info'}>
                {statusLabels[bill.status] ?? bill.status}
              </Badge>
            </div>
            <p className="muted mb-3 mt-6">
              Сплачено {paidCount} із {bill.shares.length} часток
            </p>
            <div
              className="h-2 overflow-hidden rounded-full bg-line"
              role="progressbar"
              aria-label="Сплачені частки"
              aria-valuenow={paidCount}
              aria-valuemin={0}
              aria-valuemax={bill.shares.length}
            >
              <div
                className="h-full rounded-full bg-positive"
                style={{
                  width: `${bill.shares.length ? (paidCount / bill.shares.length) * 100 : 0}%`,
                }}
              />
            </div>
            {bill.dueAt && (
              <p
                className={`mt-4 text-sm ${overdue ? 'text-negative' : 'text-muted'}`}
              >
                {overdue ? 'Прострочено · ' : 'Сплатити до: '}
                {dateLabel(bill.dueAt)}
              </p>
            )}
            <CopyId value={bill.id} />
          </Card>
          <Card>
            <h2 className="mb-5">Учасники</h2>
            <ul className="divide-y">
              {bill.shares.map((share) => (
                <li
                  key={share.id}
                  className="flex flex-wrap items-center gap-3 py-4 first:pt-0 last:pb-0"
                >
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-sm font-semibold text-accent"
                    aria-hidden="true"
                  >
                    {share.participantEmail.slice(0, 2).toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="break-all text-sm font-medium">
                      {share.participantEmail}{' '}
                      {share.id === own?.id && (
                        <span className="whitespace-nowrap text-muted">
                          (ви)
                        </span>
                      )}
                    </p>
                    <p className="amount mt-1 text-sm text-muted">
                      {money(share.amount)} {bill.currency}
                    </p>
                  </div>
                  <Badge
                    tone={
                      share.status === 'PAID'
                        ? 'positive'
                        : share.status === 'PAYING'
                          ? 'caution'
                          : 'neutral'
                    }
                  >
                    {statusLabels[share.status] ?? share.status}
                  </Badge>
                  {share.id === own?.id && own.status === 'PENDING' && (
                    <Button
                      disabled={busy}
                      loading={busy}
                      onClick={() => void accept()}
                    >
                      Підтвердити свою частку
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          {own &&
            (own.status === 'ACCEPTED' ||
              (!!attempt.current && !monitor.transfer)) && (
              <Card>
                <h2>Ваша частка</h2>
                <p className="amount mb-5 mt-3 text-2xl font-semibold">
                  {money(own.amount)}{' '}
                  <span className="text-sm text-muted">{bill.currency}</span>
                </p>
                <form onSubmit={pay}>
                  <Field id="share-wallet" label="Гаманець для оплати">
                    <select
                      key={restoredWallet ?? 'new'}
                      defaultValue={restoredWallet ?? undefined}
                      name="walletId"
                      disabled={busy || !!attempt.current}
                      required
                    >
                      {choices.map((wallet) => (
                        <option key={wallet.id} value={wallet.id}>
                          {wallet.currency} · {money(wallet.available)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Button
                    className="mt-5 w-full"
                    loading={busy}
                    disabled={
                      busy ||
                      (!attempt.current && !choices.length) ||
                      !!monitor.transfer
                    }
                  >
                    {attempt.current
                      ? 'Повторити ту саму оплату'
                      : 'Сплатити свою частку'}
                  </Button>
                  {!choices.length && (
                    <p className="muted mt-3">
                      <a className="text-link" href="/wallets">
                        Відкрийте гаманець у {bill.currency}
                      </a>
                      .
                    </p>
                  )}
                </form>
              </Card>
            )}
          {monitor.transfer && <TransferProgress transfer={monitor.transfer} />}
          {monitor.transfer && isFinal(monitor.transfer) && (
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                clearAttempt(scope);
                attempt.current = null;
                setRestoredWallet(null);
                monitor.track(null);
                void reload();
              }}
            >
              Оновити результат оплати
            </Button>
          )}
          {!own && (
            <Card>
              <h2>Усе під контролем</h2>
              <p className="muted mt-3">
                Кожен учасник підтверджує й оплачує свою частку. Статус рахунку
                оновлюється автоматично.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
