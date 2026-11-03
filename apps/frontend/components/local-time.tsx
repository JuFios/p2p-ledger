'use client';

import { useSyncExternalStore } from 'react';
import { LOCALE } from '@/lib/format';

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function useLocalTime() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}

type TimeFormat = 'date' | 'time' | 'datetime' | 'day';

export function formatLocalTime(value: string, format: TimeFormat, local: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  if (format === 'day' && local) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Сьогодні';
    if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
  }
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: local ? undefined : 'UTC',
    ...(format !== 'time' ? { day: 'numeric', month: 'short', year: 'numeric' } as const : {}),
    ...(format === 'time' || format === 'datetime' ? { hour: '2-digit', minute: '2-digit' } as const : {}),
  }).format(date);
}

export function LocalTime({
  value,
  format = 'date',
  className,
}: {
  value: string;
  format?: TimeFormat;
  className?: string;
}) {
  const local = useLocalTime();
  return (
    <time dateTime={value} className={className}>
      {formatLocalTime(value, format, local)}
    </time>
  );
}
