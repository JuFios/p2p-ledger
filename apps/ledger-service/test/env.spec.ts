import { Test } from '@nestjs/testing';

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
describe('Environment validation', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    for (const key of REQUIRED) {
      process.env[key] = 'value';
    }
    jest.resetModules();
  });

  afterAll(() => {
    process.env = saved;
  });

  // ConfigModule.forRoot асинхронний: помилка валідації з'являється
  // під час збирання модуля, до будь-якого підключення до БД.
  async function boot() {
    const { AppModule } = await import('../src/app.module');
    await Test.createTestingModule({ imports: [AppModule] }).compile();
  }

  it.each(REQUIRED)('refuses to start without %s', async (name) => {
    delete process.env[name];
    await expect(boot()).rejects.toThrow(name);
  });
});
