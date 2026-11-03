import { BillStatus, ShareStatus, TransferStatus } from './types';

export function money(value: string | null | undefined) {
  if (value == null) return '—';
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction === undefined ? '' : `.${fraction}`}`;
}
export function dateLabel(value: string) {
  return new Date(value).toLocaleDateString('uk-UA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
export function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сьогодні';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчора';
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
