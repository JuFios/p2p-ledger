'use client';

import { useEffect, useRef, useState } from 'react';
import { clearAttempt, readAttempt, writeAttempt } from '@/lib/attempt-storage';
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
  const [restored, setRestored] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const pending = readAttempt<{ key: string; body: [string, string][] }>(
      'split-create',
    );
    if (!pending) return;
    try {
      if (
        !Array.isArray(pending.body) ||
        !pending.body.every(
          (pair) =>
            Array.isArray(pair) &&
            pair.length === 2 &&
            pair.every((value) => typeof value === 'string'),
        )
      )
        throw new Error();
      const data = new FormData();
      for (const [key, value] of pending.body) data.append(key, value);
      data.set('key', pending.key);
      const fields = Object.fromEntries(pending.body);
      fields.key = pending.key;
      if (!['EQUAL', 'CUSTOM'].includes(fields.mode)) throw new Error();
      if (fields.dueAt) {
        const due = new Date(fields.dueAt);
        fields.dueAt = new Date(due.getTime() - due.getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16);
      }
      saved.current = data;
      setRestored(fields);
      setMode(fields.mode);
    } catch {
      clearAttempt('split-create');
    }
  }, []);
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
    writeAttempt('split-create', {
      key: String(saved.current.get('key')),
      body: Array.from(saved.current.entries(), ([key, value]) => [
        key,
        String(value),
      ]),
    });
    setBusy(true);
    setError(null);
    try {
      const result = await createBill(saved.current);
      if (result.error) {
        setError(result.error);
        if (result.status && isDefinitiveRejection(result.status)) {
          saved.current = null;
          clearAttempt('split-create');
          setRestored(null);
        }
      } else if (result.id) {
        clearAttempt('split-create');
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
      <form
        key={restored?.key ?? 'new'}
        id="create-bill-form"
        onSubmit={submit}
      >
        <fieldset
          disabled={busy || !!saved.current}
          className="grid gap-5 border-0 p-0"
        >
          <Field id="bill-title" label="Назва">
            <input
              name="title"
              defaultValue={restored?.title}
              maxLength={100}
              placeholder="Вечеря з друзями"
              required
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="bill-total" label="Загальна сума">
              <input
                name="totalAmount"
                defaultValue={restored?.totalAmount}
                type="number"
                min="0.01"
                max="1000000"
                step="0.01"
                placeholder="0.00"
                required
              />
            </Field>
            <Field id="bill-currency" label="Валюта">
              <select
                name="currency"
                defaultValue={restored?.currency ?? 'USD'}
              >
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
              defaultValue={restored?.participants}
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
            <input
              name="dueAt"
              type="datetime-local"
              defaultValue={restored?.dueAt}
            />
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
