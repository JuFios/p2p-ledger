// Значення за замовчуванням для локального запуску (docker compose up -d ledger-db).
// У CI змінні задаються явно й мають пріоритет.
const defaults: Record<string, string> = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5433',
  DATABASE_USER: 'ledger',
  DATABASE_PASSWORD: 'ledger',
  DATABASE_NAME: 'ledger',
  JWT_ACCESS_SECRET: 'e2e-access-secret',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret',
};

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value;
}
