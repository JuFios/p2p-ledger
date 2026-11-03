'use client';

import { useRouter } from 'next/navigation';
import { Field } from '@/components/ui/index';
import { useLocalTime } from '@/components/local-time';

export function periodBoundary(day: string, inclusiveEnd = false) {
  const [year, month, date] = day.split('-').map(Number);
  const boundary = new Date(year, month - 1, date);
  if (year < 100) boundary.setFullYear(year, month - 1, date);
  if (inclusiveEnd) boundary.setDate(boundary.getDate() + 1);
  return boundary.toISOString();
}

function inputDay(value: string | undefined, end: boolean, local: boolean) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  if (!local) return '';
  if (end) date.setDate(date.getDate() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function PeriodFilter({ walletId, from, to }: {
  walletId?: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const local = useLocalTime();
  return (
    <form
      key={`${local}:${walletId}:${from}:${to}`}
      className="grid items-end gap-4 md:grid-cols-2 lg:grid-cols-4"
      onInput={(event) => {
        const end = event.currentTarget.elements.namedItem('to') as HTMLInputElement;
        end.setCustomValidity('');
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const query = new URLSearchParams();
        const wallet = String(data.get('walletId') ?? '').trim();
        const start = String(data.get('from') ?? '');
        const end = String(data.get('to') ?? '');
        if (start && end && start > end) {
          const input = event.currentTarget.elements.namedItem('to') as HTMLInputElement;
          input.setCustomValidity('Дата «До» має бути не раніше дати «Від».');
          input.reportValidity();
          return;
        }
        if (wallet) query.set('walletId', wallet);
        if (start) query.set('from', periodBoundary(start));
        if (end) query.set('to', periodBoundary(end, true));
        router.push(`/admin?${query}`);
      }}
    >
      <Field id="wallet-id" label="ID гаманця">
        <input name="walletId" placeholder="Скопіюйте ID зі сторінки гаманців" defaultValue={walletId} />
      </Field>
      <Field id="period-from" label="Від (включно)">
        <input name="from" type="date" defaultValue={inputDay(from, false, local)} />
      </Field>
      <Field id="period-to" label="До (включно)">
        <input name="to" type="date" defaultValue={inputDay(to, true, local)} />
      </Field>
      <button className="button-primary" disabled={!local}>Показати</button>
      <p className="muted md:col-span-2 lg:col-span-4">
        Обидва дні включено, час — у поясі вашого пристрою.
      </p>
    </form>
  );
}
