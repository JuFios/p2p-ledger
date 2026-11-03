const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadSource } = require('./load-source.cjs');

test('logout clears both cookies even when upstream is unavailable', async (t) => {
  let body;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    body = JSON.parse(init.body);
    throw new Error('unavailable');
  });
  const { POST } = loadSource('app/api/auth/logout/route.ts');
  const res = await POST(new NextRequest('http://localhost/api/auth/logout', {
    method: 'POST', headers: { host: 'localhost', origin: 'http://localhost', cookie: 'accessToken=expired; refreshToken=current' },
  }));
  assert.deepEqual(body, { refreshToken: 'current' });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/login');
  assert.equal(res.cookies.get('accessToken').value, '');
  assert.equal(res.cookies.get('refreshToken').value, '');
});

test('logout redirects within the external origin without trusting forwarded hosts', async () => {
  const { POST } = loadSource('app/api/auth/logout/route.ts');
  for (const origin of ['http://localhost:23000', 'https://ledger.example:8443']) {
    const req = new NextRequest(`${new URL(origin).protocol}//internal:3000/api/auth/logout`, {
      method: 'POST', headers: {
        host: new URL(origin).host, origin,
        'x-forwarded-host': 'untrusted.example:9999',
      },
    });
    const res = await POST(req);
    assert.equal(res.status, 303);
    assert.equal(new URL(res.headers.get('location'), origin).href, `${origin}/login`);
    assert.equal(res.cookies.get('accessToken').value, '');
    assert.equal(res.cookies.get('refreshToken').value, '');
  }
});
test('logout rejects cross-origin posts before revoking or clearing cookies', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; });
  const { POST } = loadSource('app/api/auth/logout/route.ts');
  const res = await POST(new NextRequest('http://localhost/api/auth/logout', {
    method: 'POST', headers: { host: 'localhost', origin: 'https://foreign.test', cookie: 'refreshToken=current' },
  }));
  assert.equal(res.status, 403);
  assert.equal(calls, 0);
  assert.equal(res.cookies.getAll().length, 0);
});
