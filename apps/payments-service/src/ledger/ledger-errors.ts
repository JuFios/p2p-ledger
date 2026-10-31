// Відповідь ledger на виклик саги — одна з двох:
// остаточна відмова (4xx з кодом) — повтор нічого не змінить;
// невизначений результат (5xx, таймаут, мережа, breaker open) — операція
// могла як виконатись, так і ні, тож її повторюють з тим самим operationId.

export class LedgerRejection extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'LedgerRejection';
  }
}

export class LedgerUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LedgerUnavailable';
  }
}

// 401/403 (неправильний міжсервісний токен), 408 і 429 — не відповідь по суті,
// а збій, що може минути: їх повторюємо.
const RETRYABLE_4XX = [401, 403, 408, 429];

export function classifyLedgerError(error: unknown): Error {
  const response = (
    error as { response?: { status?: number; data?: unknown } }
  )?.response;
  const status = response?.status;
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    !RETRYABLE_4XX.includes(status)
  ) {
    const body = (response?.data ?? {}) as { code?: unknown; message?: unknown };
    return new LedgerRejection(
      status,
      typeof body.code === 'string' ? body.code : `HTTP_${status}`,
      typeof body.message === 'string'
        ? body.message
        : JSON.stringify(body.message ?? ''),
    );
  }
  return new LedgerUnavailable(
    status !== undefined
      ? `ledger відповів ${status}`
      : `ledger недоступний: ${(error as Error)?.message ?? error}`,
  );
}
