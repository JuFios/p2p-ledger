'use client';

import { Transfer } from '@/lib/types';

const steps = [
  'RISK_CHECK',
  'RESOLVE_RECIPIENT',
  'FX_QUOTE',
  'HOLD',
  'CONFIRM',
  'CAPTURE',
  'DONE',
];
const labels: Record<string, string> = {
  RISK_CHECK: 'Перевірка обмежень',
  RESOLVE_RECIPIENT: 'Пошук отримувача',
  FX_QUOTE: 'Курс обміну',
  HOLD: 'Резервування коштів',
  CONFIRM: 'Підтвердження',
  CAPTURE: 'Зарахування',
  DONE: 'Завершено',
};
export function TransferProgress({ transfer }: { transfer: Transfer }) {
  return (
    <section aria-label="Стан переказу" aria-live="polite">
      <p>
        Переказ: <code>{transfer.id}</code>
      </p>
      <p>
        Статус: <strong>{transfer.status}</strong> · крок: {transfer.step}
      </p>
      {transfer.failureReason && (
        <p style={{ color: 'crimson' }}>Причина: {transfer.failureReason}</p>
      )}
      {transfer.step === 'RELEASE_HOLD' && <p>Зняття резерву коштів.</p>}
      <ol>
        {steps.map((step) => (
          <li
            key={step}
            style={{ fontWeight: transfer.step === step ? 'bold' : 'normal' }}
          >
            {labels[step]} {transfer.step === step ? '←' : ''}
          </li>
        ))}
      </ol>
      {transfer.toAmount && (
        <p>
          До зарахування: {transfer.toAmount} {transfer.toCurrency}
        </p>
      )}
    </section>
  );
}
