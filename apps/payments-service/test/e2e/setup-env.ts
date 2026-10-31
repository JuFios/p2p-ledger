// Значення за замовчуванням для локального запуску
// (docker compose up -d payments-db redis; БД payments_e2e:
// docker compose exec payments-db createdb -U payments payments_e2e).
// У CI змінні задаються явно й мають пріоритет. ledger підміняє
// FakeLedger на LEDGER_SERVICE_URL.
const defaults: Record<string, string> = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5434',
  DATABASE_USER: 'payments',
  DATABASE_PASSWORD: 'payments',
  DATABASE_NAME: 'payments_e2e',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  OUTBOX_POLL_INTERVAL_MS: '100',
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  LEDGER_SERVICE_URL: 'http://localhost:4599',
  INTERNAL_API_TOKEN: 'e2e-internal-token',
  FX_RATES_JSON: '{"USD":1,"EUR":0.92,"UAH":41.5}',
  FX_MAX_QUOTE_AGE_MS: '60000',
  TRANSFER_MAX_AMOUNT: '10000',
  BLOCKED_EMAILS: 'blocked@example.com',
  SAGA_STEP_TIMEOUT_MS: '2000',
  SAGA_MAX_ATTEMPTS: '3',
  SAGA_RETRY_BASE_MS: '50',
  SAGA_RUNNER_INTERVAL_MS: '50',
  CB_TIMEOUT_MS: '500',
  CB_RESET_TIMEOUT_MS: '300',
  // Високий ліміт: паралельні запити тестів не впираються в 429.
  TRANSFER_RATE_LIMIT: '1000',
  TRANSFER_RATE_TTL_MS: '60000',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
