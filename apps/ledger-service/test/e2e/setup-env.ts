// Значення за замовчуванням для локального запуску
// (docker compose up -d ledger-db redis).
// У CI змінні задаються явно й мають пріоритет.
const defaults: Record<string, string> = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5433',
  DATABASE_USER: 'ledger',
  DATABASE_PASSWORD: 'ledger',
  DATABASE_NAME: 'ledger_e2e',
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  OUTBOX_POLL_INTERVAL_MS: '100',
  INTERNAL_API_TOKEN: 'e2e-internal-token',
  ADMIN_EMAIL: 'e2e-admin@example.com',
  ADMIN_PASSWORD: 'e2e-admin-password',
  LOGIN_RATE_LIMIT: '5',
  LOGIN_IP_RATE_LIMIT: '20',
  LOGIN_RATE_TTL_MS: '60000',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
