import 'reflect-metadata';
import { validate } from '../src/config/env.validation';

const required = {
  DATABASE_HOST: 'localhost',
  DATABASE_USER: 'payments',
  DATABASE_PASSWORD: 'payments',
  DATABASE_NAME: 'payments',
  REDIS_HOST: 'localhost',
  JWT_ACCESS_SECRET: 'secret',
  LEDGER_SERVICE_URL: 'http://ledger-service:3001',
  INTERNAL_API_TOKEN: 'token',
  FX_RATES_JSON: '{"USD":1,"EUR":0.92,"UAH":41.5}',
};

describe('валідація env', () => {
  it('приводить числа й підставляє значення за замовчуванням', () => {
    const config = validate({ ...required, SAGA_MAX_ATTEMPTS: '7' });
    expect(config.SAGA_MAX_ATTEMPTS).toBe(7);
    expect(config.PORT).toBe(3002);
    expect(config.TRANSFER_MAX_AMOUNT).toBe(10000);
  });

  it.each(Object.keys(required))('без %s сервіс не стартує', (key) => {
    const config: Record<string, unknown> = { ...required };
    delete config[key];
    expect(() => validate(config)).toThrow(key);
  });

  it.each([
    ['не JSON', 'nope'],
    ['без валюти', '{"USD":1,"EUR":0.92}'],
    ['недодатний курс', '{"USD":1,"EUR":0,"UAH":41.5}'],
  ])('FX_RATES_JSON %s — помилка', (_name, value) => {
    expect(() => validate({ ...required, FX_RATES_JSON: value })).toThrow(
      /FX_RATES_JSON/,
    );
  });

  it('TRANSFER_MAX_AMOUNT з трьома знаками — помилка', () => {
    expect(() => validate({ ...required, TRANSFER_MAX_AMOUNT: '10.001' })).toThrow(
      /TRANSFER_MAX_AMOUNT/,
    );
  });
});
