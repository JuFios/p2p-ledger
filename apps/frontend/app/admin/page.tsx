import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { bffFetch } from '@/lib/api';
import { sessionClaims } from '@/lib/session';
import { uuid } from '@/lib/validation';

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

async function Events({ walletId }: { walletId?: string }) {
  if (!walletId)
    return <p>Вкажіть ID гаманця, щоб переглянути журнал подій.</p>;
  if (!uuid(walletId)) return <p role="alert">Некоректний ID гаманця.</p>;
  try {
    const events = await bffFetch<LedgerEvent[]>(
      `/admin/wallets/${walletId}/events`,
    );
    if (!events.length) return <p>Подій немає.</p>;
    return (
      <ol>
        {events.map((event) => (
          <li key={event.eventId}>
            <strong>{event.type}</strong> · {event.recordedAt}
            <details>
              <summary>Дані події</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
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
    return (
      <p role="alert" style={{ color: 'crimson' }}>
        {(err as Error).message}
      </p>
    );
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
      <>
        <p role="status">
          {result.ok ? 'Звірка успішна' : 'Виявлено розбіжності'}
        </p>
        <table style={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              <th>Валюта</th>
              <th>Дебет</th>
              <th>Кредит</th>
              <th>Різниця</th>
            </tr>
          </thead>
          <tbody>
            {result.perCurrency.map((row) => (
              <tr key={row.currency}>
                <td>{row.currency}</td>
                <td>{row.debits}</td>
                <td>{row.credits}</td>
                <td>{row.diff}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result.perCurrency.length === 0 && (
          <p>Проводок за цей період немає.</p>
        )}
        <p>Розбіжностей проєкції: {result.projectionMismatches.length}</p>
        {result.projectionMismatches.length > 0 && (
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(result.projectionMismatches, null, 2)}
          </pre>
        )}
      </>
    );
  } catch (err) {
    return (
      <p role="alert" style={{ color: 'crimson' }}>
        {(err as Error).message}
      </p>
    );
  }
}
async function Traces() {
  try {
    const traces = await bffFetch<Trace[]>('/admin/traces?limit=10');
    if (!traces.length) return <p>Трасувань поки немає.</p>;
    return (
      <ul>
        {traces.map((trace) => (
          <li key={trace.traceId} style={{ marginBottom: 20 }}>
            <code style={{ overflowWrap: 'anywhere' }}>{trace.traceId}</code>
            {trace.spans.length === 0 && <p>Кроки саги ще не отримані.</p>}
            <ul>
              {trace.spans.map((span) => (
                <li key={span.spanId}>
                  {span.operationName}:{' '}
                  <strong>{span.durationMs.toFixed(2)} мс</strong>
                  {span.transferId && (
                    <small
                      style={{ display: 'block', overflowWrap: 'anywhere' }}
                    >
                      Переказ: {span.transferId}
                    </small>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    );
  } catch (err) {
    return (
      <p role="alert" style={{ color: 'crimson' }}>
        {(err as Error).message}
      </p>
    );
  }
}
export default async function AdminPage({
  searchParams,
}: {
  searchParams: { walletId?: string; from?: string; to?: string };
}) {
  if (sessionClaims(cookies().get('accessToken')?.value)?.role !== 'admin') {
    return (
      <main style={{ maxWidth: 600, margin: '48px auto', padding: 16 }}>
        <h1>Адміністрування</h1>
        <p>Доступ лише для адміністратора.</p>
      </main>
    );
  }
  return (
    <main style={{ maxWidth: 900, margin: '48px auto', padding: 16 }}>
      <h1>Адміністрування</h1>
      <form method="get" style={{ display: 'grid', gap: 12 }}>
        <label>
          ID гаманця{' '}
          <input name="walletId" defaultValue={searchParams.walletId} />
        </label>
        <label>
          Від (ISO 8601, необов’язково){' '}
          <input
            name="from"
            placeholder="2026-11-01T00:00:00Z"
            defaultValue={searchParams.from}
          />
        </label>
        <label>
          До (ISO 8601, необов’язково){' '}
          <input name="to" defaultValue={searchParams.to} />
        </label>
        <button>Показати</button>
      </form>
      <section>
        <h2>Журнал подій гаманця</h2>
        <Suspense
          key={searchParams.walletId ?? ''}
          fallback={<p>Завантаження подій…</p>}
        >
          <Events walletId={searchParams.walletId} />
        </Suspense>
      </section>
      <section>
        <h2>Reconciliation</h2>
        <Suspense
          key={`${searchParams.from}:${searchParams.to}`}
          fallback={<p>Звірка балансів…</p>}
        >
          <ReconciliationSection
            from={searchParams.from}
            to={searchParams.to}
          />
        </Suspense>
      </section>
      <section>
        <h2>Останні трасування</h2>
        <Suspense fallback={<p>Завантаження трасувань…</p>}>
          <Traces />
        </Suspense>
      </section>
    </main>
  );
}
