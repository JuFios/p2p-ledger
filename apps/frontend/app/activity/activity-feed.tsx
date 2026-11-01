'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { clientFetch } from '@/lib/http';
import { ACTIVITY_TYPES, Activity } from '@/lib/types';
import { useLiveSocket } from '@/lib/use-live-socket';
import { LiveStatus } from '@/components/live-status';

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
  const status = useLiveSocket({
    onConnect: reload,
    onActivity: () => void reload(),
  });
  return (
    <>
      <LiveStatus status={status} />
      <label>
        Тип операції{' '}
        <select
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            setItems([]);
          }}
        >
          <option value="">Усі операції</option>
          {ACTIVITY_TYPES.map((value) => (
            <option key={value} value={value}>
              {labels[value]}
            </option>
          ))}
        </select>
      </label>{' '}
      <button onClick={() => void reload()}>Оновити</button>
      {loading && <p role="status">Завантаження активності…</p>}
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      {!error && !loading && items.length === 0 && <p>Операцій поки немає.</p>}
      <ul>
        {items.map((item) => (
          <li key={item.id} style={{ margin: '20px 0' }}>
            <strong>{labels[item.type] ?? item.type}</strong> ·{' '}
            <time>{item.createdAt}</time>
            {typeof item.payload.amount === 'string' && (
              <p>
                {item.payload.amount} {String(item.payload.currency ?? '')}
              </p>
            )}
            {typeof item.payload.title === 'string' && (
              <p>{item.payload.title}</p>
            )}
            {typeof item.payload.failureReason === 'string' && (
              <p>{item.payload.failureReason}</p>
            )}
            {typeof item.payload.billId === 'string' && (
              <p>
                <a
                  href={`/split-bills/${encodeURIComponent(item.payload.billId)}`}
                >
                  Відкрити рахунок
                </a>
              </p>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
