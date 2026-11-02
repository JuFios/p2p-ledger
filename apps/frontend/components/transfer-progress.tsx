'use client';
import { Transfer } from '@/lib/types';
import { failureLabel, money, statusLabels } from '@/lib/format';
import { Alert, Badge, Card } from './ui/index';
import { CopyId } from './ui/copy-id';
const steps = [
  'RISK_CHECK',
  'RESOLVE_RECIPIENT',
  'FX_QUOTE',
  'HOLD',
  'CONFIRM',
  'CAPTURE',
  'DONE',
];
const labels = [
  'Ризики',
  'Адреса',
  'Курс',
  'Резерв',
  'Згода',
  'Кошти',
  'Готово',
];
export function TransferProgress({ transfer }: { transfer: Transfer }) {
  const complete = transfer.status === 'COMPLETED';
  const failed = transfer.status === 'FAILED';
  const compensating = transfer.step === 'RELEASE_HOLD';
  const position = compensating ? 4 : Math.max(0, steps.indexOf(transfer.step));
  return (
    <Card aria-label="Стан переказу" aria-live="polite" className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">
          Стан переказу
        </p>
        <Badge tone={complete ? 'positive' : failed ? 'negative' : 'info'}>
          {transfer.status}
        </Badge>
      </div>
      <div
        className={`my-6 flex h-14 w-14 items-center justify-center rounded-full ${complete ? 'bg-positive/10 text-positive' : failed ? 'bg-negative/10 text-negative' : 'bg-accent/10 text-accent'}`}
      >
        <svg
          aria-hidden="true"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {complete ? (
            <path d="m5 12 4 4L19 6" />
          ) : failed ? (
            <path d="m6 6 12 12M6 18 18 6" />
          ) : (
            <>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </>
          )}
        </svg>
      </div>
      <h2 className="text-2xl">
        {complete
          ? 'Переказ завершено'
          : failed
            ? 'Переказ не виконано'
            : (statusLabels[transfer.status] ?? 'Переказ виконується')}
      </h2>
      <p className="muted mt-2">
        {complete
          ? 'Кошти зараховано отримувачу.'
          : failed
            ? 'Перевірте причину відмови перед новою спробою.'
            : 'Оновлення з’являються автоматично.'}
      </p>
      <ol className="my-7 grid grid-cols-7 gap-1" aria-label="Кроки переказу">
        {steps.map((step, i) => {
          const done = complete || i < position;
          const active = !compensating && !complete && i === position;
          return (
            <li
              key={step}
              aria-current={active ? 'step' : undefined}
              className="min-w-0 text-center"
            >
              <span
                className={`mx-auto flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${done ? 'bg-positive/10 text-positive' : active ? (failed ? 'bg-negative text-canvas' : 'bg-accent text-on-accent') : 'bg-canvas text-muted'}`}
              >
                {done ? '✓' : active && failed ? '×' : i + 1}
              </span>
              <span className="sr-only sm:not-sr-only sm:mt-2 sm:block sm:text-xs sm:leading-4 sm:text-muted">
                {labels[i]}
              </span>
            </li>
          );
        })}
      </ol>
      {!complete && !failed && (
        <p className="mb-5 text-center text-xs text-muted sm:hidden">
          {compensating
            ? 'Повернення резерву'
            : `Крок ${position + 1} із 7 · ${labels[position]}`}
        </p>
      )}
      {compensating && (
        <div className="mb-4">
          <Alert tone={failed ? 'negative' : 'caution'}>
            Зняття резерву коштів.{' '}
            {failed
              ? 'Компенсацію завершено.'
              : 'Очікуємо повернення коштів у доступний баланс.'}
          </Alert>
        </div>
      )}
      {transfer.failureReason && (
        <div className="mb-4">
          <Alert>{failureLabel(transfer.failureReason)}</Alert>
        </div>
      )}
      <dl className="grid grid-cols-2 gap-4 border-t pt-5">
        <div>
          <dt className="muted">
            {complete ? 'Надіслано' : failed ? 'Сума запиту' : 'Сума'}
          </dt>
          <dd className="amount mt-1 text-lg font-semibold">
            {money(transfer.amount)}{' '}
            <span className="text-xs text-muted">{transfer.currency}</span>
          </dd>
        </div>
        <div className="text-right">
          <dt className="muted">
            {complete ? 'Отримано' : failed ? 'Зараховано' : 'До зарахування'}
          </dt>
          <dd className="amount mt-1 text-lg font-semibold">
            {failed ? '0.00' : money(transfer.toAmount)}{' '}
            <span className="text-xs text-muted">{transfer.toCurrency}</span>
          </dd>
        </div>
      </dl>
      <div className="mt-4">
        <CopyId value={transfer.id} />
      </div>
    </Card>
  );
}
