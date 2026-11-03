const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const walletId = 'cb5cce0f-0b57-439c-8d6b-bc10546b58f1';
const claims = (exp, role = 'user') =>
  `e30.${Buffer.from(JSON.stringify({ sub: walletId, email: 'user@example.com', exp, role })).toString('base64url')}.signature`;
const valid = claims(Math.floor(Date.now() / 1000) + 3600);
const admin = claims(Math.floor(Date.now() / 1000) + 3600, 'admin');
const expired = claims(1);
const wallet = {
  id: walletId,
  currency: 'USD',
  balance: '12.34',
  available: '10.34',
  held: '2.00',
  frozen: false,
};
let server,
  app,
  base,
  received,
  refreshCalls = 0;
let appOutput = '';

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}

before(async () => {
  server = http.createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part;
    received = { url: req.url, headers: req.headers, body };
    if (req.url === '/auth/login')
      return json(res, 200, { accessToken: valid, refreshToken: 'rotated' });
    if (req.url === '/auth/register')
      return json(res, 409, { message: 'Email already registered' });
    if (req.url === '/auth/refresh') {
      refreshCalls++;
      const token = JSON.parse(body).refreshToken;
      if (token === 'unavailable')
        return json(res, 503, { message: 'Unavailable' });
      if (token !== 'refresh' && token !== 'concurrent')
        return json(res, 401, { message: 'Invalid refresh' });
      if (token === 'concurrent')
        await new Promise((resolve) => setTimeout(resolve, 100));
      return json(res, 200, { accessToken: valid, refreshToken: 'rotated' });
    }
    if (![valid, admin].includes(req.headers.authorization?.slice(7)))
      return json(res, 401, { message: 'Invalid bearer' });
    if (
      req.url.startsWith('/admin/') &&
      req.headers.authorization !== `Bearer ${admin}`
    )
      return json(res, 403, { message: 'Forbidden' });
    if (req.url === '/wallets') return json(res, 200, [wallet]);
    if (req.url === '/transfers' && req.method === 'POST') {
      const data = JSON.parse(body);
      if (data.fail) {
        if (data.fail === 429) res.setHeader('Retry-After', '7');
        return json(res, data.fail, {
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Conflict',
        });
      }
      return json(res, 202, { id: walletId, status: 'PENDING', step: 'HOLD' });
    }
    if (req.url.startsWith('/activity?')) return json(res, 200, []);
    if (req.url === '/split-bills') return json(res, 200, []);
    if (req.url.startsWith('/admin/traces'))
      return json(res, 503, { message: 'Trace backend unavailable' });
    if (req.url.startsWith('/admin/reconciliation')) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return json(res, 200, {
        ok: true,
        perCurrency: [],
        projectionMismatches: [],
      });
    }
    if (req.url.startsWith('/admin/wallets/'))
      return json(res, 200, [
        {
          eventId: walletId,
          type: 'MoneyDeposited',
          recordedAt: '2026-11-01',
          payload: {},
          metadata: {},
        },
      ]);
    return json(res, 404, { message: 'Not found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  app = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'start',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(port),
    ],
    {
      env: {
        ...process.env,
        BFF_URL: `http://127.0.0.1:${server.address().port}`,
        WS_PUBLIC_URL: 'http://ws.example.test:3003',
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  app.stdout.on('data', (data) => {
    appOutput += data;
  });
  app.stderr.on('data', (data) => {
    appOutput += data;
  });
  for (let i = 0; i < 100; i++) {
    if (app.exitCode !== null) throw new Error(appOutput);
    try {
      if ((await fetch(`${base}/login`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Next.js failed to start: ${appOutput}`);
});

after(async () => {
  if (app?.exitCode === null) {
    app.kill('SIGTERM');
    await once(app, 'exit');
  }
  if (server) await new Promise((resolve) => server.close(resolve));
});

function request(path, init = {}) {
  return fetch(`${base}${path}`, {
    redirect: 'manual',
    ...init,
    headers: { Cookie: `accessToken=${valid}`, ...init.headers },
  });
}
function post(body) {
  return {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'stable-payment-key',
    },
    body: JSON.stringify(body),
  };
}

test('protected pages redirect an anonymous user and APIs return JSON 401', async () => {
  const page = await request('/wallets', { headers: { Cookie: '' } });
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get('location')).pathname, '/login');
  const api = await request('/api/bff/wallets', { headers: { Cookie: '' } });
  assert.equal(api.status, 401);
  assert.match((await api.json()).message, /Увійдіть/);
});
test('login stores both tokens as HttpOnly SameSite cookies', async () => {
  const res = await request(
    '/api/auth/login',
    post({ email: 'user@example.com', password: 'password' }),
  );
  assert.equal(res.status, 200);
  const cookies = res.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=lax/i);
  }
  assert.deepEqual(await res.json(), { ok: true });
});
test('register preserves the BFF rejection status', async () => {
  const res = await request('/api/auth/register', post({}));
  assert.equal(res.status, 409);
});
test('logout preserves the browser origin behind a proxy and clears both cookies', async () => {
  const origin = 'http://public.example:7443';
  const res = await new Promise((resolve, reject) => {
    const req = http.request(`${base}/api/auth/logout`, {
      method: 'POST', headers: { Origin: origin, Host: 'public.example:7443',
        'X-Forwarded-Host': 'untrusted.example:9999', Cookie: `accessToken=${valid}` },
    }, response => {
      response.resume();
      response.once('end', () => resolve(response));
    });
    req.once('error', reject);
    req.end();
  });
  assert.equal(res.statusCode, 303);
  assert.equal(new URL(res.headers.location, origin).href, `${origin}/login`);
  for (const name of ['accessToken', 'refreshToken']) {
    assert(res.headers['set-cookie'].some(cookie => cookie.startsWith(`${name}=;`)));
  }
});
test('server rendering uses the access cookie and BFF wallet data', async () => {
  const res = await request('/wallets');
  assert.equal(res.status, 200);
  assert.match(await res.text(), /12\.34/);
  assert.equal(received.headers.authorization, `Bearer ${valid}`);
});
test('expired access refreshes cookies before the same server render', async () => {
  const before = refreshCalls;
  const res = await request('/wallets', {
    headers: { Cookie: `accessToken=${expired}; refreshToken=refresh` },
  });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /12\.34/);
  assert.equal(refreshCalls, before + 1);
  assert.equal(received.headers.authorization, `Bearer ${valid}`);
  assert.ok(
    res.headers
      .getSetCookie()
      .some((value) => value.startsWith('refreshToken=rotated;')),
  );
});
test('concurrent expired requests share one refresh operation', async () => {
  const before = refreshCalls;
  const responses = await Promise.all(
    Array.from({ length: 8 }, () =>
      request('/api/bff/wallets', {
        headers: { Cookie: `accessToken=${expired}; refreshToken=concurrent` },
      }),
    ),
  );
  assert.ok(responses.every((res) => res.status === 200));
  assert.equal(refreshCalls, before + 1);
});
test('invalid refresh clears the session and returns 401 for client requests', async () => {
  const res = await request('/api/bff/wallets', {
    headers: { Cookie: `accessToken=${expired}; refreshToken=invalid` },
  });
  assert.equal(res.status, 401);
  assert.ok(
    res.headers
      .getSetCookie()
      .some((value) => value.startsWith('accessToken=;')),
  );
});
test('temporary refresh failure keeps cookies so the user can retry', async () => {
  const res = await request('/api/bff/wallets', {
    headers: { Cookie: `accessToken=${expired}; refreshToken=unavailable` },
  });
  assert.equal(res.status, 503);
  assert.equal(res.headers.getSetCookie().length, 0);
});
test('ws handshake endpoint returns runtime URL and access token without refresh token or caching', async () => {
  const res = await request('/api/auth/ws-token');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), {
    token: valid,
    url: 'http://ws.example.test:3003',
  });
});
test('client proxy preserves the payment key, request body, bearer and 202', async () => {
  const body = { amount: 0.29, currency: 'USD' };
  const res = await request('/api/bff/transfers', post(body));
  assert.equal(res.status, 202);
  assert.equal(received.headers['idempotency-key'], 'stable-payment-key');
  assert.equal(received.headers.authorization, `Bearer ${valid}`);
  assert.deepEqual(JSON.parse(received.body), body);
  assert.equal((await res.json()).status, 'PENDING');
});
test('client proxy preserves conflict JSON and rate limit Retry-After', async () => {
  const conflict = await request('/api/bff/transfers', post({ fail: 422 }));
  assert.equal(conflict.status, 422);
  assert.equal((await conflict.json()).code, 'IDEMPOTENCY_KEY_REUSED');
  const limited = await request('/api/bff/transfers', post({ fail: 429 }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '7');
});
test('cross-origin mutations are rejected before reaching the BFF', async () => {
  const before = received;
  const res = await request('/api/bff/transfers', {
    ...post({}),
    headers: { Origin: 'https://other.example' },
  });
  assert.equal(res.status, 403);
  assert.equal(received, before);
});
test('proxy never exposes internal or auth routes', async () => {
  for (const path of ['internal/users', 'auth/refresh']) {
    const res = await request(`/api/bff/${path}`);
    assert.equal(res.status, 404);
  }
});
test('activity query parameters reach the BFF unchanged', async () => {
  const res = await request('/api/bff/activity?type=DEPOSIT&limit=5');
  assert.equal(res.status, 200);
  assert.equal(received.url, '/activity?type=DEPOSIT&limit=5');
});
test('normal users see the admin access state', async () => {
  const res = await request('/admin');
  assert.match(await res.text(), /Доступ лише для адміністратора/);
  assert.equal((await request('/api/bff/admin/traces')).status, 403);
});
test('admin streams successful sections when the trace backend fails', async () => {
  const res = await request(`/admin?walletId=${walletId}`, {
    headers: { Cookie: `accessToken=${admin}` },
  });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Звірка успішна/);
  assert.match(html, /MoneyDeposited/);
  assert.match(html, /Trace backend unavailable/);
  assert.match(html, /Звірка балансів/);
});
