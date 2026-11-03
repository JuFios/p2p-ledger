import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { bffFetch } from '@/lib/api';
import { sessionClaims } from '@/lib/session';
import { uuid } from '@/lib/validation';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  PageHeading,
  Skeleton,
} from '@/components/ui/index';
import { CopyId } from '@/components/ui/copy-id';
import { dateLabel, money } from '@/lib/format';

interface Reconciliation {
  ok: boolean;
  perCurrency: {
    currency: string;
    debits: string;
    credits: string;
    diff: string;
  }[];
  projectionMismatches: unknown[];
}
interface Trace {
  traceId: string;
  spans: {
    spanId: string;
    operationName: string;
    durationMs: number;
    transferId: string | null;
  }[];
}
interface LedgerEvent {
  eventId: string;
  type: string;
  recordedAt: string;
  payload: unknown;
  metadata: unknown;
}

function Retry() {
  return (
    <a className="button-secondary" href="/admin">
      Спробувати ще раз
    </a>
  );
}
function SectionLoading({ label = 'Завантаження…' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
async function Events({ walletId }: { walletId?: string }) {
  if (!walletId)
    return (
      <EmptyState
        title="Оберіть гаманець"
        description="Вкажіть ID гаманця, щоб переглянути журнал подій."
        action={
          <a className="button-secondary" href="#wallet-id">
            Вказати ID гаманця
          </a>
        }
      />
    );
  if (!uuid(walletId))
    return <Alert action={<Retry />}>Некоректний ID гаманця.</Alert>;
  try {
    const events = await bffFetch<LedgerEvent[]>(
      `/admin/wallets/${walletId}/events`,
    );
    if (!events.length)
      return (
        <EmptyState
          title="Подій немає"
          description="Журнал поповниться після першої операції з гаманцем."
          action={
            <a className="button-secondary" href="/wallets">
              До гаманців
            </a>
          }
        />
      );
    return (
      <ol className="ml-2 space-y-6 border-l pl-6">
        {events.map((event) => (
          <li key={event.eventId} className="relative min-w-0">
            <span className="absolute -left-8 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-accent" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="break-all text-sm">{event.type}</h3>
              <time className="text-xs text-muted" dateTime={event.recordedAt}>
                {dateLabel(event.recordedAt)}
              </time>
            </div>
            <CopyId value={event.eventId} />
            <details className="mt-1 rounded-lg bg-canvas p-3 text-sm">
              <summary className="text-muted">Дані події</summary>
              <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs leading-6">
                {JSON.stringify(
                  { payload: event.payload, metadata: event.metadata },
                  null,
                  2,
                )}
              </pre>
            </details>
          </li>
        ))}
      </ol>
    );
  } catch (err) {
    return <Alert action={<Retry />}>{(err as Error).message}</Alert>;
  }
}
async function ReconciliationSection({
  from,
  to,
}: {
  from?: string;
  to?: string;
}) {
  const query = new URLSearchParams();
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  try {
    const result = await bffFetch<Reconciliation>(
      `/admin/reconciliation?${query}`,
    );
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div
            className={`rounded-xl border p-5 ${result.ok ? 'border-positive/20 bg-positive/5' : 'border-negative/20 bg-negative/5'}`}
          >
            <p className="muted">Стан обліку</p>
            <p
              role="status"
              className={`mt-3 text-xl font-semibold ${result.ok ? 'text-positive' : 'text-negative'}`}
            >
              {result.ok ? 'Звірка успішна' : 'Виявлено розбіжності'}
            </p>
          </div>
          <div className="rounded-xl border bg-canvas p-5">
            <p className="muted">Розбіжностей проєкції</p>
            <p className="amount mt-2 text-3xl font-semibold">
              {result.projectionMismatches.length}
            </p>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full">
            <thead className="bg-canvas">
              <tr>
                <th>Валюта</th>
                <th className="text-right">Дебет</th>
                <th className="text-right">Кредит</th>
                <th className="text-right">Різниця</th>
              </tr>
            </thead>
            <tbody>
              {result.perCurrency.map((row) => (
                <tr key={row.currency}>
                  <td className="font-medium">{row.currency}</td>
                  <td className="amount text-right">{money(row.debits)}</td>
                  <td className="amount text-right">{money(row.credits)}</td>
                  <td className="amount text-right">{money(row.diff)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!result.perCurrency.length && (
            <p className="muted p-6">Проводок за цей період немає.</p>
          )}
        </div>
        {!!result.projectionMismatches.length && (
          <pre className="overflow-auto whitespace-pre-wrap break-all rounded-lg bg-canvas p-4 text-xs">
            {JSON.stringify(result.projectionMismatches, null, 2)}
          </pre>
        )}
      </div>
    );
  } catch (err) {
    return <Alert action={<Retry />}>{(err as Error).message}</Alert>;
  }
}
async function Traces() {
  try {
    const traces = await bffFetch<Trace[]>('/admin/traces?limit=10');
    if (!traces.length)
      return (
        <EmptyState
          title="Трасувань поки немає"
          description="Виконайте переказ, щоб побачити час його обробки."
          action={
            <a className="button-secondary" href="/transfers/new">
              Зробити переказ
            </a>
          }
        />
      );
    return (
      <ul className="space-y-6">
        {traces.map((trace) => {
          const total = trace.spans.reduce(
            (sum, span) => sum + span.durationMs,
            0,
          );
          let offset = 0;
          return (
            <li key={trace.traceId} className="rounded-xl border p-4 sm:p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <CopyId value={trace.traceId} />
                <Badge tone="info">
                  {total.toFixed(2)} мс · {trace.spans.length} кроків
                </Badge>
              </div>
              {!trace.spans.length && (
                <p className="muted">Кроки саги ще не отримані.</p>
              )}
              <ol className="space-y-4">
                {trace.spans.map((span) => {
                  const start = offset;
                  offset += span.durationMs;
                  return (
                    <li key={span.spanId}>
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                        <span className="break-words text-xs font-medium">
                          {span.operationName.replace('saga.step ', '')}
                        </span>
                        <span className="amount text-xs text-muted">
                          {span.durationMs.toFixed(2)} мс
                        </span>
                      </div>
                      <div className="relative h-3 overflow-hidden rounded-full bg-canvas">
                        <div
                          className="absolute h-full min-w-0.5 rounded-full bg-accent/70"
                          style={{
                            left: `${total ? (start / total) * 100 : 0}%`,
                            width: `${total ? (span.durationMs / total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      {span.transferId && (
                        <div className="mt-1">
                          <CopyId value={span.transferId} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </li>
          );
        })}
      </ul>
    );
  } catch (err) {
    return <Alert action={<Retry />}>{(err as Error).message}</Alert>;
  }
}
export default async function AdminPage({
  searchParams,
}: {
  searchParams: { walletId?: string; from?: string; to?: string };
}) {
  if (sessionClaims(cookies().get('accessToken')?.value)?.role !== 'admin')
    return (
      <main className="page">
        <PageHeading
          title="Адміністрування"
          description="Журнал подій, звірка балансів і трасування переказів."
        />
        <EmptyState
          title="Доступ лише для адміністратора."
          description="Ваша роль не надає доступу до цієї сторінки."
          action={
            <a className="button-primary" href="/wallets">
              До моїх гаманців
            </a>
          }
        />
      </main>
    );
  return (
    <main className="page max-w-6xl">
      <PageHeading
        title="Адміністрування"
        description="Перевіряйте облік і досліджуйте шлях кожного переказу."
      />
      <Card className="mb-6">
        <form
          method="get"
          className="grid items-end gap-4 md:grid-cols-2 lg:grid-cols-4"
        >
          <Field id="wallet-id" label="ID гаманця">
            <input
              name="walletId"
              placeholder="UUID гаманця"
              defaultValue={searchParams.walletId}
            />
          </Field>
          <Field id="period-from" label="Від (YYYY-MM-DD або дата-час із Z/±hh:mm)">
            <input
              name="from"
              placeholder="2026-11-01T00:00:00Z"
              defaultValue={searchParams.from}
            />
          </Field>
          <Field id="period-to" label="До (YYYY-MM-DD або дата-час із Z/±hh:mm)">
            <input
              name="to"
              placeholder="2026-11-02T00:00:00Z"
              defaultValue={searchParams.to}
            />
          </Field>
          <button className="button-primary">Показати</button>
        </form>
      </Card>
      <nav
        aria-label="Розділи адміністрування"
        className="mb-6 flex flex-wrap gap-2"
      >
        <a className="button-secondary" href="#reconciliation">
          Звірка
        </a>
        <a className="button-secondary" href="#events">
          Журнал подій
        </a>
        <a className="button-secondary" href="#traces">
          Трасування
        </a>
      </nav>
      <section id="reconciliation" className="surface mb-6">
        <h2 className="mb-5">Reconciliation</h2>
        <Suspense
          key={`${searchParams.from}:${searchParams.to}`}
          fallback={<SectionLoading label="Звірка балансів…" />}
        >
          <ReconciliationSection
            from={searchParams.from}
            to={searchParams.to}
          />
        </Suspense>
      </section>
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <section id="events" className="surface min-w-0">
          <h2 className="mb-5">Журнал подій гаманця</h2>
          <Suspense
            key={searchParams.walletId ?? ''}
            fallback={<SectionLoading />}
          >
            <Events walletId={searchParams.walletId} />
          </Suspense>
        </section>
        <section id="traces" className="surface min-w-0">
          <h2 className="mb-5">Останні трасування</h2>
          <Suspense fallback={<SectionLoading />}>
            <Traces />
          </Suspense>
        </section>
      </div>
    </main>
  );
}
