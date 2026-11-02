const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');
const { NextRequest } = require('next/server');

test('late requests reuse completed refresh only within the grace window', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const original = global.fetch;
  const accessToken = `e30.${Buffer.from(JSON.stringify({ sub: 'user', exp: 9999999999 })).toString('base64url')}.sig`;
  global.fetch = async () => {
    calls++;
    return calls === 1
      ? Response.json({ accessToken, refreshToken: 'new-refresh' })
      : Response.json({}, { status: 401 });
  };
  try {
    const { middleware } = loadSource('middleware.ts');
    const request = () => new NextRequest('http://localhost/wallets', { headers: { Cookie: 'refreshToken=old-refresh' } });
    const first = await middleware(request());
    const late = await middleware(request());
    assert.equal(calls, 1);
    assert.equal(first.cookies.get('refreshToken').value, 'new-refresh');
    assert.equal(late.cookies.get('refreshToken').value, 'new-refresh');
    t.mock.timers.tick(30001);
    const expired = await middleware(request());
    assert.equal(calls, 2);
    assert.equal(new URL(expired.headers.get('location')).pathname, '/login');
  } finally { global.fetch = original; }
});
