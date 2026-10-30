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

  it('accepts a complete environment', async () => {
    await expect(import('../src/app.module')).resolves.toBeDefined();
  });

  it.each(REQUIRED)('refuses to start without %s', async (name) => {
    delete process.env[name];
    await expect(import('../src/app.module')).rejects.toThrow(name);
  });
});
