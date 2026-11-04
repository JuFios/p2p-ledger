const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://localhost:3000/login',
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) {
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const container = document.getElementById('root');
let root;

beforeEach(() => {
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});

// Сторінка входу з відповіддю /api/auth/login: текст помилки після submit.
async function loginWith(t, response) {
  t.mock.method(globalThis, 'fetch', async () => response);
  const pushed = [];
  const { default: LoginPage } = loadSource('app/login/page.tsx', {
    'next/navigation': { useRouter: () => ({ push: (url) => pushed.push(url) }) },
  });
  await act(async () => root.render(React.createElement(LoginPage)));
  await act(async () => {
    container
      .querySelector('form')
      .dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  });
  return { text: container.textContent, pushed };
}

test('login page explains an unavailable service instead of a wrong password', async (t) => {
  const { text, pushed } = await loginWith(t, new Response('{}', { status: 503 }));
  assert.match(text, /Сервіс тимчасово недоступний/);
  assert.doesNotMatch(text, /Невірний email або пароль/);
  assert.deepEqual(pushed, []);
});

test('login page shows the wait from Retry-After and a wrong password on 401', async (t) => {
  const limited = await loginWith(
    t,
    new Response('{}', { status: 429, headers: { 'Retry-After': '42' } }),
  );
  assert.match(limited.text, /через 42 с/);
  await act(async () => root.unmount());
  root = createRoot(container);
  const wrong = await loginWith(t, new Response('{}', { status: 401 }));
  assert.match(wrong.text, /Невірний email або пароль/);
});

test('login page does not blame the password for a rejected request origin', async (t) => {
  const { text, pushed } = await loginWith(t, new Response('{}', { status: 403 }));
  assert.match(text, /Не вдалося увійти/);
  assert.doesNotMatch(text, /Невірний email або пароль/);
  assert.deepEqual(pushed, []);
});
