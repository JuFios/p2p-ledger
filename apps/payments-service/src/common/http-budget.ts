// Split create/pay виконують один послідовний ledger-виклик; пошук учасників
// паралельний. Залишаємо запас на локальну транзакцію та кожен proxy-hop.
const HOP_MARGIN_MS = { ledger: 0, bff: 2000, frontend: 5000 } as const;

export function httpBudget(ledgerTimeout: unknown = 3000, hop: keyof typeof HOP_MARGIN_MS = 'ledger') {
  const ledgerTimeoutMs = Number(ledgerTimeout);
  const validTimeout = Number.isInteger(ledgerTimeoutMs) &&
    ledgerTimeoutMs >= 1 && ledgerTimeoutMs <= 60000;
  if (!validTimeout) {
    throw new Error('CB_TIMEOUT_MS must be an integer between 1 and 60000');
  }
  return ledgerTimeoutMs + HOP_MARGIN_MS[hop];
}
