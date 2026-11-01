import 'reflect-metadata';
import { validate } from '../src/config/env.validation';
const valid = {
  LEDGER_SERVICE_URL: 'http://ledger-service:3001',
  PAYMENTS_SERVICE_URL: 'http://payments-service:3002',
  NOTIFICATIONS_SERVICE_URL: 'http://notifications-service:3003',
  JAEGER_QUERY_URL: 'http://jaeger:16686',
  JWT_ACCESS_SECRET: 'test-secret',
};
it('validates required service URLs and secret and converts the port', () => {
  expect(validate(valid).PORT).toBe(3004);
  expect(validate({ ...valid, PORT: '3005' }).PORT).toBe(3005);
  for (const key of Object.keys(valid))
    expect(() => validate({ ...valid, [key]: undefined })).toThrow();
  for (const PORT of [0, 65536, 'bad'])
    expect(() => validate({ ...valid, PORT })).toThrow();
  expect(() =>
    validate({ ...valid, LEDGER_SERVICE_URL: 'file:///etc/passwd' }),
  ).toThrow();
});

it('rejects invalid observability settings', () => {
  expect(() => validate({ ...valid, LOG_LEVEL: 'verbose' })).toThrow();
  expect(() => validate({ ...valid, OTEL_SERVICE_NAME: '' })).toThrow();
  expect(() =>
    validate({ ...valid, OTEL_EXPORTER_OTLP_ENDPOINT: 'not-a-url' }),
  ).toThrow();
});
