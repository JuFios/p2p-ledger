import { BillStatus, ShareStatus, TransferStatus } from './types';

export function money(value: string | null | undefined) {
  if (value == null) return '—';
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction === undefined ? '' : `.${fraction}`}`;
}
// Усі дати показуємо в одному поясі, щоб SSR і браузер не розходились.
const TIME_ZONE = 'Europe/Kyiv';
const dayKey = (date: Date) =>
  date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
// Попередній календарний день від ключа YYYY-MM-DD; не залежить від DST.
function previousDayKey(key: string) {
  const date = new Date(`${key}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('uk-UA', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('uk-UA', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
  });
}
export function dayLabel(value: string) {
  const day = dayKey(new Date(value));
  const today = dayKey(new Date());
  if (day === today) return 'Сьогодні';
  if (day === previousDayKey(today)) return 'Вчора';
  return dateLabel(value);
}
export const statusLabels: Record<TransferStatus | ShareStatus | BillStatus, string> = {
  PENDING: 'Очікує',
  PROCESSING: 'Виконується',
  AWAITING_RETRY: 'Очікує повтору',
  COMPENSATING: 'Повернення коштів',
  COMPLETED: 'Завершено',
  FAILED: 'Не виконано',
  ACCEPTED: 'Підтверджено',
  PAYING: 'Оплачується',
  PAID: 'Сплачено',
  PARTIALLY_PAID: 'Частково сплачено',
  SETTLED: 'Рахунок закрито',
};
export function failureLabel(reason: string) {
  return (
    (
      {
        RECIPIENT_FROZEN: 'Гаманець отримувача заморожено.',
        WALLET_FROZEN: 'Гаманець заморожено.',
        INSUFFICIENT_FUNDS: 'Недостатньо доступних коштів.',
        SELF_TRANSFER: 'Оберіть іншого отримувача.',
        RECIPIENT_NOT_FOUND: 'Користувача з цим email не знайдено.',
        LIMIT_EXCEEDED: 'Сума перевищує ліміт переказу.',
        BLOCKED: 'Переказ відхилено перевіркою обмежень.',
        FX_QUOTE_EXPIRED: 'Строк курсу обміну завершився.',
        RETRIES_EXHAUSTED: 'Сервіс не відповів після повторних спроб.',
        CAPTURE_UNCONFIRMED:
          'Зарахування не підтверджено. Перевірте підсумковий баланс.',
        AMOUNT_TOO_SMALL:
          'Сума після обміну менша за мінімальну одиницю валюти.',
      } as Record<string, string>
    )[reason] ??
    `Переказ відхилено (${reason}). Перевірте дані та спробуйте ще раз.`
  );
}
