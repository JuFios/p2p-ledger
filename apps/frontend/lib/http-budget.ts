// Split create/pay виконують один послідовний ledger-виклик; пошук учасників
// паралельний. Залишаємо запас на локальну транзакцію та кожен proxy-hop.
export const DEFAULT_LEDGER_TIMEOUT_MS = 3000;
export function httpBudget(ledgerTimeoutMs = DEFAULT_LEDGER_TIMEOUT_MS) {
  if (!Number.isInteger(ledgerTimeoutMs) || ledgerTimeoutMs < 1 || ledgerTimeoutMs > 60000) {
    throw new Error('CB_TIMEOUT_MS must be an integer between 1 and 60000');
  }
  return { ledger: ledgerTimeoutMs, bff: ledgerTimeoutMs + 2000, frontend: ledgerTimeoutMs + 5000 };
}
