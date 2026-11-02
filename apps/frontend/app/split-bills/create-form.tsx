'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CURRENCIES } from '@/lib/types';
import { Alert, Button, Card, Field } from '@/components/ui/index';
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
    <Card id="create-bill">
      <h2>Створити спільний рахунок</h2>
      <p className="muted mb-6 mt-2">Вкажіть загальну суму та учасників.</p>
      {error && (
        <div className="mb-5">
          <Alert
            action={
              <Button
                type="submit"
                form="create-bill-form"
                variant="ghost"
                disabled={busy}
              >
                Спробувати ще раз
              </Button>
            }
          >
            {error}
          </Alert>
        </div>
      )}
      <form id="create-bill-form" onSubmit={submit}>
        <fieldset
          disabled={busy || !!saved.current}
          className="grid gap-5 border-0 p-0"
        >
          <Field id="bill-title" label="Назва">
            <input
              name="title"
              maxLength={100}
              placeholder="Вечеря з друзями"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="bill-total" label="Загальна сума">
              <input
                name="totalAmount"
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                placeholder="0.00"
                required
              />
            </Field>
            <Field id="bill-currency" label="Валюта">
              <select name="currency">
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field id="bill-mode" label="Поділ">
            <select
              name="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="EQUAL">Порівну</option>
              <option value="CUSTOM">Власні суми</option>
            </select>
          </Field>
          <Field
            id="bill-participants"
            label="Учасники (по одному в рядку)"
            help={`${mode === 'EQUAL' ? 'Вкажіть email кожного учасника.' : 'У кожному рядку: email, пробіл і сума частки.'} Не включайте себе.`}
          >
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
          </Field>
          <Field id="bill-due" label="Термін оплати (необов’язково)">
            <input name="dueAt" type="datetime-local" />
          </Field>
        </fieldset>
        <Button loading={busy} className="mt-6 w-full">
          {busy
            ? 'Створення…'
            : saved.current
              ? 'Повторити створення'
              : 'Створити рахунок'}
        </Button>
      </form>
    </Card>
  );
}
