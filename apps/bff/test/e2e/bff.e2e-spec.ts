import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import request from 'supertest';
import { configureApp } from '../../src/configure-app';

interface Call {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: unknown;
}
interface Fake {
  server: Server;
  url: string;
  calls: Call[];
  status: number;
  data: unknown;
  headers: Record<string, string>;
  hang: boolean;
}
async function fake(): Promise<Fake> {
  const state = {
    calls: [],
    status: 200,
    data: [],
    headers: {},
    hang: false,
  } as unknown as Fake;
  state.server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      state.calls.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body ? JSON.parse(body) : undefined,
      });
      if (state.hang) return;
      res.writeHead(state.status, {
        'Content-Type': 'application/json',
        ...state.headers,
      });
      res.end(JSON.stringify(state.data));
    },
  );
  await new Promise<void>((done) => state.server.listen(0, '127.0.0.1', done));
  state.url = `http://127.0.0.1:${(state.server.address() as { port: number }).port}`;
  return state;
}

const wallet = '11111111-1111-4111-8111-111111111111';
const share = '22222222-2222-4222-8222-222222222222';
const transfer = {
  fromWalletId: wallet,
  toWalletIdentifier: 'bob@example.com',
  amount: 0.29,
  currency: 'USD',
};
const bill = {
  title: 'Dinner',
  totalAmount: 10,
  currency: 'USD',
  mode: 'EQUAL',
  participants: [{ email: 'bob@example.com' }],
};
const secret = 'bff-test-secret';
const jwt = new JwtService({ secret });
const token = jwt.sign({
  sub: wallet,
  email: 'alice@example.com',
  role: 'user',
});
const admin = jwt.sign({
  sub: wallet,
  email: 'admin@example.com',
  role: 'admin',
});
let app: INestApplication;
let ledger: Fake, payments: Fake, notifications: Fake, jaeger: Fake;

beforeAll(async () => {
  [ledger, payments, notifications, jaeger] = await Promise.all([
    fake(),
    fake(),
    fake(),
    fake(),
  ]);
  Object.assign(process.env, {
    LEDGER_SERVICE_URL: ledger.url,
    PAYMENTS_SERVICE_URL: payments.url,
    NOTIFICATIONS_SERVICE_URL: notifications.url,
    JAEGER_QUERY_URL: jaeger.url,
    JWT_ACCESS_SECRET: secret,
    LOG_LEVEL: 'silent',
  });
  const { AppModule } = await import('../../src/app.module');
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = module.createNestApplication();
  configureApp(app);
  await app.listen(0, '127.0.0.1');
});
afterAll(async () => {
  await app?.close();
  await Promise.all(
    [ledger, payments, notifications, jaeger]
      .filter(Boolean)
      .map(async (source) => {
        source.server.closeAllConnections();
        await new Promise<void>((done) => source.server.close(() => done()));
      }),
  );
});
beforeEach(() => {
  for (const source of [ledger, payments, notifications, jaeger]) {
    source.calls = [];
    source.status = 200;
    source.data = [];
    source.headers = {};
    source.hang = false;
  }
});

it.each([
  ['/wallets', 'ledger'],
  ['/wallets/' + wallet, 'ledger'],
  ['/transfers?limit=7', 'payments'],
  ['/transfers/' + wallet, 'payments'],
  ['/split-bills?limit=7', 'payments'],
  ['/split-bills/' + wallet, 'payments'],
  ['/activity?type=DEPOSIT&limit=7', 'notifications'],
] as const)(
  'proxies GET %s with the original authorization',
  async (path, sourceName) => {
    const source = { ledger, payments, notifications }[sourceName];
    source.data = [{ id: wallet }];
    const authorization = `Bearer ${token}`;
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', authorization)
      .expect(200, source.data);
    expect(source.calls).toHaveLength(1);
    expect(source.calls[0].url).toBe(path);
    expect(source.calls[0].headers.authorization).toBe(authorization);
  },
);

it.each([
  ['/wallets', { currency: 'EUR' }, 'ledger'],
  [`/wallets/${wallet}/deposit`, { amount: 0.29 }, 'ledger'],
  [`/wallets/${wallet}/withdraw`, { amount: 10 }, 'ledger'],
  ['/transfers', transfer, 'payments'],
  ['/split-bills', bill, 'payments'],
  [`/split-bills/${wallet}/shares/${share}/accept`, {}, 'payments'],
  [
    `/split-bills/${wallet}/shares/${share}/pay`,
    { fromWalletId: wallet },
    'payments',
  ],
] as const)(
  'proxies POST %s and preserves the idempotency key and status',
  async (path, body, sourceName) => {
    const source = { ledger, payments }[sourceName];
    source.status = 202;
    source.data = { id: wallet, status: 'PENDING' };
    const key = 'Retry:Same-Key_123';
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', key)
      .send({ ...body, unknownField: 'stripped' })
      .expect(202, source.data);
    expect(source.calls[0]).toMatchObject({ method: 'POST', url: path, body });
    expect(source.calls[0].headers['idempotency-key']).toBe(key);
    expect(source.calls[0].headers.authorization).toBe(`Bearer ${token}`);
  },
);

it.each([
  ['/auth/register', { email: 'new@example.com', password: 'password' }],
  ['/auth/login', { email: 'new@example.com', password: 'password' }],
  ['/auth/refresh', { refreshToken: 'refresh-token' }],
])('allows public %s and forwards the validated body', async (path, body) => {
  ledger.status = 201;
  ledger.data = { accessToken: 'access' };
  await request(app.getHttpServer())
    .post(path)
    .send(body)
    .expect(201, ledger.data);
  expect(ledger.calls[0]).toMatchObject({ url: path, body });
});

it.each([200, 401, 404, 409, 422, 429, 503])(
  'preserves upstream status %i and error body',
  async (status) => {
    payments.status = status;
    payments.data = { code: 'UPSTREAM_RESULT', message: 'Result' };
    payments.headers = { 'Retry-After': '60' };
    const response = await request(app.getHttpServer())
      .post('/transfers')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', 'same')
      .send(transfer)
      .expect(status, payments.data);
    expect(response.headers['retry-after']).toBe('60');
  },
);

it.each([
  ['/auth/register', { email: 'bad', password: 'short' }],
  ['/auth/login', { email: 'bad', password: 123 }],
  ['/auth/refresh', { refreshToken: 123 }],
  ['/wallets', { currency: 'BTC' }],
  [`/wallets/${wallet}/deposit`, { amount: 1e-7 }],
  [`/wallets/${wallet}/withdraw`, { amount: -1 }],
  ['/transfers', { ...transfer, fromWalletId: 'bad' }],
  ['/transfers', { ...transfer, amount: 1.001 }],
  ['/transfers', { ...transfer, amount: '10' }],
  ['/split-bills', { ...bill, participants: [{ email: 'invalid' }] }],
  ['/split-bills', { ...bill, dueAt: '2026-02-31' }],
  [`/split-bills/${wallet}/shares/${share}/pay`, { fromWalletId: 'bad' }],
])(
  'rejects invalid POST %s before contacting a service',
  async (path, body) => {
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(400);
    expect(ledger.calls.length + payments.calls.length).toBe(0);
  },
);

it.each([
  '/wallets',
  '/transfers',
  '/split-bills',
  '/activity',
  '/dashboard',
  '/admin/traces',
])('requires JWT for %s', async (path) => {
  for (const authorization of [
    '',
    'Bearer bad',
    `Bearer ${jwt.sign({ sub: wallet }, { expiresIn: -1 })}`,
  ]) {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', authorization)
      .expect(401);
  }
  expect(
    ledger.calls.length +
      payments.calls.length +
      notifications.calls.length +
      jaeger.calls.length,
  ).toBe(0);
});

it.each([
  '/wallets/bad',
  '/transfers/bad',
  '/split-bills/bad',
  '/activity?limit=101',
  '/activity?type=BAD',
  '/transfers?limit=1.5',
])('validates GET %s locally', async (path) => {
  await request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .expect(400);
  expect(
    ledger.calls.length + payments.calls.length + notifications.calls.length,
  ).toBe(0);
});

it.each(['ledger', 'payments', 'notifications'] as const)(
  'degrades only the %s dashboard section',
  async (failed) => {
    const sources = { ledger, payments, notifications };
    sources[failed].status = 503;
    const result = await request(app.getHttpServer())
      .get('/dashboard')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    for (const [name, source] of Object.entries(sources)) {
      const section = {
        ledger: 'wallets',
        payments: 'transfers',
        notifications: 'activity',
      }[name]!;
      expect(result.body[section]).toEqual(
        name === failed
          ? { error: { statusCode: 503, message: 'Source unavailable' } }
          : { data: [] },
      );
      expect(source.calls[0].headers.authorization).toBe(`Bearer ${token}`);
    }
    expect(payments.calls[0].url).toBe('/transfers?limit=10');
    expect(notifications.calls[0].url).toBe('/activity?limit=10');
  },
);

it('bounds an unresponsive dashboard source and preserves the other sections', async () => {
  payments.hang = true;
  const response = await request(app.getHttpServer())
    .get('/dashboard')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  expect(response.body).toEqual({
    wallets: { data: [] },
    activity: { data: [] },
    transfers: { error: { statusCode: 503, message: 'Source unavailable' } },
  });
});

it('returns 503 on a proxy network failure', async () => {
  ledger.hang = true;
  await request(app.getHttpServer())
    .get('/wallets')
    .set('Authorization', `Bearer ${token}`)
    .expect(503);
});

it.each([
  '/admin/traces',
  '/admin/reconciliation',
  `/admin/wallets/${wallet}/events`,
])('requires the admin role for %s', async (path) => {
  await request(app.getHttpServer())
    .get(path)
    .set('Authorization', `Bearer ${token}`)
    .expect(403);
  expect(ledger.calls.length + jaeger.calls.length).toBe(0);
});
it('protects freeze and proxies allowed admin operations', async () => {
  const path = `/admin/wallets/${wallet}/freeze`;
  await request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${token}`)
    .send({})
    .expect(403);
  await request(app.getHttpServer())
    .post(path)
    .set('Authorization', `Bearer ${admin}`)
    .send({})
    .expect(200);
  await request(app.getHttpServer())
    .get(`/admin/wallets/${wallet}/events`)
    .set('Authorization', `Bearer ${admin}`)
    .expect(200);
  await request(app.getHttpServer())
    .get('/admin/reconciliation?from=2026-01-01&to=2026-12-31')
    .set('Authorization', `Bearer ${admin}`)
    .expect(200);
  expect(ledger.calls.map((call) => call.url)).toEqual([
    path,
    `/admin/wallets/${wallet}/events`,
    '/admin/reconciliation?from=2026-01-01&to=2026-12-31',
  ]);
});

it('queries the verified root operation and returns ordered saga attempts in milliseconds', async () => {
  const span = (
    spanID: string,
    operationName: string,
    startTime: number,
    duration: number,
    processID = 'p1',
  ) => ({
    spanID,
    operationName,
    startTime,
    duration,
    processID,
    tags: [{ key: 'transfer.id', value: wallet }],
  });
  jaeger.data = {
    data: [
      {
        traceID: 'trace-id',
        processes: {
          p1: { serviceName: 'payments-service' },
          p2: { serviceName: 'ledger-service' },
        },
        spans: [
          span('later', 'saga.step HOLD', 3000, 12345),
          span('http', 'POST /transfers', 1000, 1),
          span('earlier', 'saga.step HOLD', 2000, 500),
          span('other', 'saga.step HOLD', 2000, 500, 'p2'),
        ],
      },
    ],
  };
  await request(app.getHttpServer())
    .get('/admin/traces?limit=7')
    .set('Authorization', `Bearer ${admin}`)
    .expect(200, [
      {
        traceId: 'trace-id',
        spans: [
          {
            spanId: 'earlier',
            operationName: 'saga.step HOLD',
            startTime: 2000,
            durationMs: 0.5,
            transferId: wallet,
          },
          {
            spanId: 'later',
            operationName: 'saga.step HOLD',
            startTime: 3000,
            durationMs: 12.345,
            transferId: wallet,
          },
        ],
      },
    ]);
  const url = new URL(jaeger.calls[0].url!, jaeger.url);
  expect(Object.fromEntries(url.searchParams)).toEqual({
    service: 'payments-service',
    operation: 'POST /transfers',
    limit: '7',
  });
  expect(jaeger.calls[0].headers.authorization).toBeUndefined();
});

it('handles empty and unavailable Jaeger responses', async () => {
  jaeger.data = { data: [] };
  await request(app.getHttpServer())
    .get('/admin/traces')
    .set('Authorization', `Bearer ${admin}`)
    .expect(200, []);
  jaeger.status = 500;
  await request(app.getHttpServer())
    .get('/admin/traces')
    .set('Authorization', `Bearer ${admin}`)
    .expect(503);
});

it('does not expose arbitrary upstream or internal paths', async () => {
  for (const path of [
    '/internal/users/by-email/a@example.com',
    '/auth/other',
    '/admin/other',
    '/wallets/extra/path',
  ]) {
    await request(app.getHttpServer())
      .get(path)
      .set('Authorization', `Bearer ${admin}`)
      .expect(404);
  }
  expect(ledger.calls).toHaveLength(0);
});

it('serves health, metrics and a Swagger schema with mutation fields', async () => {
  await request(app.getHttpServer())
    .get('/health')
    .expect(200)
    .expect(({ body }) => expect(body.status).toBe('ok'));
  await request(app.getHttpServer())
    .get('/metrics')
    .expect(200)
    .expect(({ text }) =>
      expect(text).toContain('process_cpu_user_seconds_total'),
    );
  const response = await request(app.getHttpServer())
    .get('/docs-json')
    .expect(200);
  expect(response.body.paths['/admin/traces'].get.security).toEqual([
    { bearer: [] },
  ]);
  expect(
    response.body.components.schemas.CreateTransferDto.properties.amount,
  ).toBeDefined();
  expect(
    response.body.components.schemas.CreateSplitBillDto.properties.participants,
  ).toBeDefined();
});


it('forwards logout without an access token and preserves 204', async () => {
  ledger.status = 204;
  await request(app.getHttpServer()).post('/auth/logout')
    .send({ refreshToken: 'current-refresh' }).expect(204);
  expect(ledger.calls[0]).toMatchObject({
    url: '/auth/logout', body: { refreshToken: 'current-refresh' },
  });
});
it('validates the logout refresh token before calling ledger', async () => {
  await request(app.getHttpServer()).post('/auth/logout')
    .send({ refreshToken: 123 }).expect(400);
  expect(ledger.calls).toHaveLength(0);
});
