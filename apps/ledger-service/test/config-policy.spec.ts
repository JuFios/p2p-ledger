import { validateRequiredConfig } from '../src/config/config-policy';

it.each([undefined, '', '   ', '\t\n'])(
  'rejects absent or blank secrets (%s) without exposing values',
  value => {
    expect(() => validateRequiredConfig({ JWT_ACCESS_SECRET: value }, ['JWT_ACCESS_SECRET']))
      .toThrow('JWT_ACCESS_SECRET');
  },
);

it('checks production passwords only when the service selects a password policy', () => {
  const config = { NODE_ENV: 'production', ADMIN_PASSWORD: 'short' };
  const required = ['ADMIN_PASSWORD'];
  expect(() => validateRequiredConfig(config, required)).not.toThrow();
  expect(() => validateRequiredConfig(config, required, required)).toThrow('ADMIN_PASSWORD');
  expect(() => validateRequiredConfig({
    ...config, ADMIN_PASSWORD: 'change-me-password',
  }, required, required)).toThrow('ADMIN_PASSWORD');
  expect(() => validateRequiredConfig({
    ...config, ADMIN_PASSWORD: 'a'.repeat(12),
  }, required, required)).not.toThrow();
});

it('keeps explicit demo secrets distinct from production secrets', () => {
  const demo = { JWT_ACCESS_SECRET: 'change-me-access' };
  expect(() => validateRequiredConfig(demo, ['JWT_ACCESS_SECRET'])).not.toThrow();
  expect(() => validateRequiredConfig({ ...demo, NODE_ENV: 'production' }, ['JWT_ACCESS_SECRET']))
    .toThrow('production requires');
  expect(() => validateRequiredConfig({
    JWT_ACCESS_SECRET: 'a'.repeat(32), NODE_ENV: 'production',
  }, ['JWT_ACCESS_SECRET'])).not.toThrow();
});
