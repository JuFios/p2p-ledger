const defaults: Record<string, string> = {
  DATABASE_HOST: 'localhost',
  DATABASE_PORT: '5435',
  DATABASE_USER: 'notifications',
  DATABASE_PASSWORD: 'notifications',
  DATABASE_NAME: 'notifications_e2e',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6380',
  JWT_ACCESS_SECRET: 'test-access-secret',
  CORS_ORIGIN: 'http://localhost:3000',
  CONSUMER_NAME: 'notifications-e2e',
  CONSUMER_CLAIM_IDLE_MS: '50',
  CONSUMER_MAX_DELIVERIES: '3',
};
for (const [key, value] of Object.entries(defaults)) process.env[key] ??= value;
