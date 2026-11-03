'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clientFetch } from '@/lib/http';
import { ACTIVITY_TYPES, Activity } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  Skeleton,
} from '@/components/ui/index';
import { failureLabel, money } from '@/lib/format';
import { LocalTime, useLocalTime, formatLocalTime } from '@/components/local-time';

const labels: Record<string, string> = {
  DEPOSIT: 'Поповнення',
  WITHDRAWAL: 'Виведення',
  TRANSFER_SENT: 'Надісланий переказ',
  TRANSFER_RECEIVED: 'Отриманий переказ',
  TRANSFER_FAILED: 'Невдалий переказ',
  SPLIT_BILL: 'Спільний рахунок',
  SPLIT_REMINDER: 'Нагадування про оплату',
};
export function ActivityFeed({
  initial,
  initialError,
}: {
  initial: Activity[];
  initialError: string | null;
}) {
  const [items, setItems] = useState(initial);
  const [type, setType] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const reload = useCallback(async () => {
    const request = ++revision.current;
    setLoading(true);
    try {
      const values = await clientFetch<Activity[]>(
        `/activity?limit=50${type ? `&type=${type}` : ''}`,
      );
      if (request === revision.current) {
        setItems(values);
        setError(null);
      }
    } catch (err) {
      if (request === revision.current) setError((err as Error).message);
    } finally {
      if (request === revision.current) setLoading(false);
    }
  }, [type]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useLiveSocket({
    onConnect: reload,
    onActivity: () => void reload(),
  });
  const local = useLocalTime();
  const groups = new Map<string, Activity[]>();
  for (const item of items) {
    const day = formatLocalTime(item.createdAt, 'date', local);
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Тип операції"
        >
          {['', ...ACTIVITY_TYPES].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={type === value}
              className={`min-h-10 rounded-full border px-3 py-2 text-xs font-medium ${type === value ? 'border-accent bg-accent/10 text-accent' : 'bg-surface text-muted hover:text-ink'}`}
              onClick={() => {
                setType(value);
                setItems([]);
              }}
            >
              {value ? labels[value] : 'Усі операції'}
            </button>
          ))}
        </div>
        <Button variant="ghost" onClick={() => void reload()}>
          Оновити
        </Button>
      </div>
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
      {loading && !items.length && (
        <Card role="status" aria-label="Завантаження активності…">
          <span className="sr-only">Завантаження активності…</span>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-5">
              <Skeleton className="h-11 w-11 rounded-full" />
              <div className="flex-1 space-y-3">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-6 w-20" />
            </div>
          ))}
        </Card>
      )}
      {!error && !loading && !items.length && (
        <EmptyState
          title="Операцій поки немає"
          description={
            type
              ? 'Спробуйте інший фільтр або виконайте першу операцію цього типу.'
              : 'Тут з’являться поповнення, перекази та запрошення до спільних рахунків.'
          }
          action={
            type ? (
              <Button variant="secondary" onClick={() => setType('')}>
                Показати всі операції
              </Button>
            ) : (
              <a className="button-primary" href="/transfers/new">
                Зробити переказ
              </a>
            )
          }
        />
      )}
      {Array.from(groups, ([day, entries]) => (
        <section key={day}>
          <h2 className="mb-3 text-sm text-muted">
            <LocalTime value={entries[0].createdAt} format="day" />
          </h2>
          <Card className="divide-y py-0 sm:py-0">
            {entries.map((item) => {
              const received = item.type === 'TRANSFER_RECEIVED';
              const incoming =
                item.type === 'DEPOSIT' || received;
              const outgoing =
                item.type === 'WITHDRAWAL' || item.type === 'TRANSFER_SENT';
              const failed = item.type === 'TRANSFER_FAILED';
              const amount = received ? item.payload.toAmount : item.payload.amount;
              const currency = received ? item.payload.toCurrency : item.payload.currency;
              return (
                <div
                  key={item.id}
                  className="flex items-start gap-3 py-5 sm:gap-4"
                >
                  <span
                    className={`mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${incoming ? 'bg-positive/10 text-positive' : failed ? 'bg-negative/10 text-negative' : 'bg-accent/10 text-accent'}`}
                  >
                    <svg
                      aria-hidden="true"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {failed ? (
                        <path d="m7 7 10 10M7 17 17 7" />
                      ) : incoming ? (
                        <path d="M12 4v16m-6-6 6 6 6-6" />
                      ) : outgoing ? (
                        <path d="M12 20V4m-6 6 6-6 6 6" />
                      ) : (
                        <>
                          <rect x="4" y="3" width="16" height="18" rx="2" />
                          <path d="M8 8h8M8 12h8M8 16h4" />
                        </>
                      )}
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <h3 className="text-sm">
                        {labels[item.type] ?? item.type}
                      </h3>
                      {typeof amount === 'string' && (
                        <p
                          className={`amount whitespace-nowrap text-sm font-semibold ${incoming ? 'text-positive' : failed ? 'text-negative' : ''}`}
                        >
                          {incoming ? '+' : outgoing ? '−' : ''}
                          {money(amount)}{' '}
                          <span className="text-xs font-normal text-muted">
                            {String(currency ?? '')}
                          </span>
                        </p>
                      )}
                    </div>
                    <LocalTime
                      className="mt-1 block text-xs text-muted"
                      value={item.createdAt}
                      format="time"
                    />
                    {typeof item.payload.title === 'string' && (
                      <p className="muted mt-2 break-words">
                        {item.payload.title}
                      </p>
                    )}
                    {typeof item.payload.failureReason === 'string' && (
                      <p className="mt-2 text-sm text-negative">
                        {failureLabel(item.payload.failureReason)}
                      </p>
                    )}
                    {typeof item.payload.billId === 'string' && (
                      <a
                        className="text-link mt-2 inline-block text-sm"
                        href={`/split-bills/${encodeURIComponent(item.payload.billId)}`}
                      >
                        Відкрити рахунок →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>
        </section>
      ))}
    </div>
  );
}
