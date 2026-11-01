'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CURRENCIES } from '@/lib/types';
import { isDefinitiveRejection } from '@/lib/http';
import { createBill } from './actions';

export function CreateBillForm() {
  const router = useRouter();
  const [mode, setMode] = useState('EQUAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = useRef<FormData | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!saved.current) {
      saved.current = new FormData(event.currentTarget);
      const due = String(saved.current.get('dueAt') ?? '');
      if (due) saved.current.set('dueAt', new Date(due).toISOString());
    }
    if (!saved.current.has('key'))
      saved.current.set('key', crypto.randomUUID());
    setBusy(true);
    setError(null);
    try {
      const result = await createBill(saved.current);
      if (result.error) {
        setError(result.error);
        if (result.status && isDefinitiveRejection(result.status))
          saved.current = null;
      } else if (result.id) {
        router.push(`/split-bills/${result.id}`);
      }
    } catch {
      setError('Зв’язок перервано. Повторіть створення з тим самим ключем.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h2>Створити спільний рахунок</h2>
      {error && (
        <p role="alert" style={{ color: 'crimson' }}>
          {error}
        </p>
      )}
      <form onSubmit={submit}>
        <fieldset
          disabled={busy || !!saved.current}
          style={{ display: 'grid', gap: 12, border: 0, padding: 0 }}
        >
          <label>
            Назва <input name="title" maxLength={100} required />
          </label>
          <label>
            Загальна сума{' '}
            <input
              name="totalAmount"
              type="number"
              min="0.01"
              max="1000000"
              step="0.01"
              required
            />
          </label>
          <label>
            Валюта{' '}
            <select name="currency">
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Поділ{' '}
            <select
              name="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="EQUAL">Порівну</option>
              <option value="CUSTOM">Власні суми</option>
            </select>
          </label>
          <label>
            Учасники (по одному в рядку){' '}
            <textarea
              name="participants"
              rows={4}
              required
              placeholder={
                mode === 'EQUAL'
                  ? 'friend@example.com'
                  : 'friend@example.com 10.50'
              }
            />
          </label>
          <p>
            {mode === 'EQUAL'
              ? 'Вкажіть email кожного учасника.'
              : 'У кожному рядку: email, пробіл і сума частки.'}{' '}
            Не включайте себе.
          </p>
          <label>
            Термін оплати (необов’язково){' '}
            <input name="dueAt" type="datetime-local" />
          </label>
        </fieldset>
        <button disabled={busy}>
          {busy
            ? 'Створення…'
            : saved.current
              ? 'Повторити створення'
              : 'Створити рахунок'}
        </button>
      </form>
    </section>
  );
}
