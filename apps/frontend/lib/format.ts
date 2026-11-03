import { BillStatus, ShareStatus, TransferStatus } from './types';

export function money(value: string | null | undefined) {
  if (value == null) return '—';
  const [whole, fraction] = value.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}${fraction === undefined ? '' : `.${fraction}`}`;
}
export const LOCALE = 'uk-UA';
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
export function statusLabel(status: string, allowed: readonly string[] = Object.keys(statusLabels)) {
  return allowed.includes(status) && Object.hasOwn(statusLabels, status)
    ? statusLabels[status as keyof typeof statusLabels]
    : status;
}
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
