import {
  ButtonHTMLAttributes,
  cloneElement,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from 'react';

export function Spinner() {
  return (
    <svg
      aria-hidden="true"
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="2"
        opacity=".25"
      />
      <path
        d="M12 3a9 9 0 0 1 9 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
export function Button({
  variant = 'primary',
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
}) {
  const variants = {
    primary: 'button-primary',
    secondary: 'button-secondary',
    ghost: 'button-ghost',
    danger: 'button-danger',
  };
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`${variants[variant]} ${className}`}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
export function Card({
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`surface ${className}`} />;
}
export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string;
  label: string;
  help?: string;
  error?: string;
  children: ReactElement<{
    id?: string;
    className?: string;
    'aria-describedby'?: string;
    'aria-invalid'?: boolean;
  }>;
}) {
  const description = help || error ? `${id}-description` : undefined;
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {cloneElement(children, {
        id,
        className: `control ${children.props.className ?? ''}`,
        'aria-describedby': description,
        'aria-invalid': !!error,
      })}
      {description && (
        <p
          id={description}
          className={`mt-2 text-xs leading-relaxed ${error ? 'text-negative' : 'text-muted'}`}
        >
          {error || help}
        </p>
      )}
    </div>
  );
}
export type Tone = 'neutral' | 'positive' | 'negative' | 'caution' | 'info';
const tones: Record<Tone, string> = {
  neutral: 'bg-canvas text-muted',
  positive: 'bg-positive/10 text-positive',
  negative: 'bg-negative/10 text-negative',
  caution: 'bg-caution/10 text-caution',
  info: 'bg-info/10 text-info',
};
export function Badge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span
      className={`inline-flex h-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
    >
      <span
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full bg-current"
      />
      {children}
    </span>
  );
}
export function Alert({
  children,
  action,
  tone = 'negative',
}: {
  children: ReactNode;
  action?: ReactNode;
  tone?: Tone;
}) {
  return (
    <div
      role="alert"
      className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border border-current/20 p-4 text-sm leading-relaxed ${tones[tone]}`}
    >
      <div className="min-w-0 break-words">{children}</div>
      {action}
    </div>
  );
}
export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-lg bg-line ${className}`}
    />
  );
}
export function EmptyState({
  title,
  description,
  action,
  level = 2,
}: {
  title: string;
  description: string;
  action: ReactNode;
  level?: 1 | 2;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <Card className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <svg
          aria-hidden="true"
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <rect x="3" y="5" width="18" height="15" rx="3" />
          <path d="M7 5V3h10v2M8 11h8M8 15h5" />
        </svg>
      </div>
      <Heading>{title}</Heading>
      <p className="muted mt-2 max-w-md">{description}</p>
      <div className="mt-6">{action}</div>
    </Card>
  );
}
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p className="muted mt-2 max-w-xl">{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Brand() {
  return (
    <span className="inline-flex items-center gap-2.5 text-base font-semibold tracking-tight">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-on-accent">
        <svg
          aria-hidden="true"
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4 4-4-4 4-4" />
        </svg>
      </span>
      P2P Ledger
    </span>
  );
}
