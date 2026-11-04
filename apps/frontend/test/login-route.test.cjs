const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NextRequest } = require('next/server');
const { loadSource } = require('./load-source.cjs');

// Збій поза відповіддю BFF кидається далі: Next.js відповідає 500 без
// подробиць і пише помилку в лог, а не «невірний пароль» з текстом помилки.
for (const name of ['login', 'register']) {
  test(`${name} rethrows an unexpected failure instead of answering with it`, async () => {
    const { ApiError } = loadSource('lib/http.ts');
    const failure = new TypeError('unexpected');
    const { POST } = loadSource(`app/api/auth/${name}/route.ts`, {
      '@/lib/api': {
        ApiError,
        bffFetch: async () => {
          throw failure;
        },
      },
    });
    const req = new NextRequest(`http://localhost/api/auth/${name}`, {
      method: 'POST',
      headers: {
        host: 'localhost',
        origin: 'http://localhost',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ email: 'a@example.com', password: 'password' }),
    });
    await assert.rejects(POST(req), (error) => error === failure);
  });
}
