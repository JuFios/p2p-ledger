import { context, propagation } from '@opentelemetry/api';

// W3C traceparent активного контексту OpenTelemetry (null, поки SDK не підключено).
export function currentTraceparent(): string | null {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ?? null;
}
