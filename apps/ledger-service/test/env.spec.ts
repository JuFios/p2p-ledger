import { validate } from '../src/config/env.validation';

const REQUIRED = [
  'DATABASE_HOST',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
];

// F4: без обов'язкових змінних сервіс не повинен стартувати
// (раніше JWT мовчки підписувався відомим секретом 'change-me-access').
// Тестуємо validate() напряму: бут модуля залежить від локального .env.
describe('Environment validation', () => {
  const complete = () =>
    Object.fromEntries(REQUIRED.map((key) => [key, 'value']));

  it('accepts a complete environment and keeps unrelated variables', () => {
    const config = { ...complete(), PORT: '3001' };
    expect(validate(config)).toEqual(config);
  });

  it.each(REQUIRED)('rejects a missing %s', (name) => {
    const config = complete();
    delete config[name];
    expect(() => validate(config)).toThrow(name);
  });

  it.each(REQUIRED)('rejects an empty %s', (name) => {
    expect(() => validate({ ...complete(), [name]: '' })).toThrow(name);
  });

  it('rejects a non-numeric DATABASE_PORT', () => {
    expect(() => validate({ ...complete(), DATABASE_PORT: 'abc' })).toThrow(
      'DATABASE_PORT',
    );
  });
});
