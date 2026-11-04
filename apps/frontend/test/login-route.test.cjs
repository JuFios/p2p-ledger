const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadSource } = require('./load-source.cjs');

// Збій поза відповіддю BFF — помилка сервісу, а не «невірний пароль».
test('login reports an unexpected failure as a server error, not a wrong password', async () => {
  const { ApiError } = loadSource('lib/http.ts');
  const { POST } = loadSource('app/api/auth/login/route.ts', {
    '@/lib/api': {
      ApiError,
      bffFetch: async () => {
        throw new TypeError('unexpected');
      },
    },
  });
  const res = await POST(new NextRequest('http://localhost/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@example.com', password: 'password' }),
  }));
  assert.equal(res.status, 500);
  assert.equal(res.cookies.getAll().length, 0);
});
