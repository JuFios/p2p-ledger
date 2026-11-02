import { spawnSync } from 'child_process';
import { resolve } from 'path';
import { tmpdir } from 'os';

const valid = {
  DATABASE_HOST: 'localhost', DATABASE_PORT: '5433', DATABASE_USER: 'ledger',
  DATABASE_PASSWORD: 'ledger', DATABASE_NAME: 'ledger_e2e',
  REDIS_HOST: 'localhost', REDIS_PORT: '6379',
  JWT_ACCESS_SECRET: 'change-me-access', JWT_REFRESH_SECRET: 'change-me-refresh',
  INTERNAL_API_TOKEN: 'change-me-internal',
  ADMIN_EMAIL: 'admin@example.com', ADMIN_PASSWORD: 'change-me-admin',
  NODE_ENV: 'test', TS_NODE_PROJECT: resolve('tsconfig.json'),
};
function boot(overrides: Record<string, string | undefined>) {
  return spawnSync(process.execPath, ['-r', require.resolve('ts-node/register'), '-e',
    `require(${JSON.stringify(resolve('src/app.module.ts'))})`], {
    cwd: tmpdir(), env: { ...process.env, ...valid, ...overrides }, encoding: 'utf8', timeout: 15000,
  });
}
it('rejects startup without a refresh secret', () => {
  const result = boot({ JWT_REFRESH_SECRET: undefined });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('JWT_REFRESH_SECRET');
});
it('rejects public placeholder secrets in production', () => {
  const result = boot({ NODE_ENV: 'production' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('JWT_ACCESS_SECRET');
});
it('accepts the public development configuration outside production', () => {
  const result = boot({});
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});
