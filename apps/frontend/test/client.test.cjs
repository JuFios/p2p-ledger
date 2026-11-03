const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');
const { EventEmitter } = require('node:events');

const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'http://localhost:3000',
});
for (const name of [
  'window',
  'document',
  'navigator',
  'HTMLElement',
  'FormData',
]) {
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

const wallet = {
  id: 'cb5cce0f-0b57-439c-8d6b-bc10546b58f1',
  currency: 'USD',
  balance: '100.00',
  available: '100.00',
  held: '0.00',
  frozen: false,
};
function json(status, body) {
  return new Response(JSON.stringify(body), { status });
}
async function submit(form) {
  await act(async () => {
    form.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    );
  });
}

test('wallet UI reloads a missed balance through useLiveSocket on reconnect', async (t) => {
  const socket = new EventEmitter();
  socket.connect = () => socket.emit('connect');
  socket.disconnect = () => socket.emit('disconnect');
  let current = wallet;
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url === '/api/auth/ws-token')
      return json(200, { token: 'test-token', url: 'http://localhost:3003' });
    assert.equal(url, '/api/bff/wallets');
    reads++;
    return json(200, [current]);
  });
  const { Wallets } = loadSource('app/wallets/wallets.tsx', {
    'socket.io-client': { io: () => socket },
  });
  await act(async () =>
    root.render(
      React.createElement(Wallets, { initial: [wallet], initialError: null }),
    ),
  );
  assert.equal(reads, 1);
  assert.match(container.textContent, /100\.00/);
  await act(async () => socket.emit('disconnect'));
  current = { ...wallet, balance: '123.45', available: '123.45' };
  assert.match(container.textContent, /100\.00/);
  await act(async () => socket.emit('connect'));
  assert.equal(reads, 2);
  assert.match(container.textContent, /123\.45/);
  assert.doesNotMatch(container.textContent, /100\.00/);
  await act(async () => root.render(null));
  assert.equal(socket.listenerCount('connect'), 0);
});

for (const status of [401, 403, 408, 429]) {
  test(`transfer keeps its key and body after an uncertain result followed by ${status}`, async (t) => {
    const received = [],
      stored = new Map();
    t.mock.method(globalThis, 'fetch', async (_url, init) => {
      const key = init.headers.get('Idempotency-Key');
      received.push({ key, body: init.body });
      if (received.length === 2)
        return json(status, { message: 'Try again later' });
      if (!stored.has(key))
        stored.set(key, {
          id: key,
          status: 'COMPLETED',
          step: 'DONE',
          amount: '10.00',
          currency: 'USD',
          toCurrency: 'USD',
        });
      if (received.length === 1)
        return json(503, { message: 'Response lost after commit' });
      return json(200, stored.get(key));
    });
    const { TransferForm } = loadSource('app/transfers/new/transfer-form.tsx', {
      '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
    });
    await act(async () =>
      root.render(
        React.createElement(TransferForm, {
          initialWallets: [wallet],
          initialError: null,
        }),
      ),
    );
    container.querySelector('[name=email]').value = 'recipient@example.com';
    container.querySelector('[name=amount]').value = '10';
    const form = container.querySelector('form');
    await submit(form);
    await submit(form);
    const locked = form.querySelector('fieldset').disabled;
    await submit(form);
    assert.equal(stored.size, 1);
    assert.equal(received.length, 3);
    assert.deepEqual(received[1], received[0]);
    assert.deepEqual(received[2], received[0]);
    assert.equal(locked, true);
    assert.match(container.textContent, /COMPLETED/);
  });
}

test('a definitive validation rejection unlocks the transfer for correction', async (t) => {
  const keys = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    keys.push(init.headers.get('Idempotency-Key'));
    return json(
      keys.length === 1 ? 400 : 200,
      keys.length === 1
        ? { message: 'Invalid amount' }
        : { id: keys[1], status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' },
    );
  });
  const { TransferForm } = loadSource('app/transfers/new/transfer-form.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
  });
  await act(async () =>
    root.render(
      React.createElement(TransferForm, {
        initialWallets: [wallet],
        initialError: null,
      }),
    ),
  );
  container.querySelector('[name=email]').value = 'recipient@example.com';
  container.querySelector('[name=amount]').value = '10';
  await submit(container.querySelector('form'));
  assert.equal(container.querySelector('fieldset').disabled, false);
  container.querySelector('[name=amount]').value = '20';
  await submit(container.querySelector('form'));
  assert.notEqual(keys[1], keys[0]);
});

async function mountMonitor() {
  const { useTransfer } = loadSource('lib/use-transfer.ts');
  let monitor;
  function Probe() {
    monitor = useTransfer();
    return React.createElement(
      'p',
      null,
      monitor.transfer?.status,
      monitor.error,
    );
  }
  await act(async () => root.render(React.createElement(Probe)));
  return () => monitor;
}

test('slow polling reaches the final state without overlapping requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pending = [];
  t.mock.method(
    globalThis,
    'fetch',
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const monitor = await mountMonitor();
  await act(async () =>
    monitor().track({ id: 'transfer', status: 'PROCESSING', step: 'DONE', currency: 'USD', toCurrency: 'USD' }),
  );
  await act(async () => t.mock.timers.tick(2100));
  assert.equal(pending.length, 1);
  await act(async () =>
    pending[0](json(200, { id: 'transfer', status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' })),
  );
  assert.equal(monitor().transfer.status, 'COMPLETED');
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(pending.length, 1);
});

test('polling recovers from an error and stops scheduling after unmount', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pending = [];
  t.mock.method(
    globalThis,
    'fetch',
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const monitor = await mountMonitor();
  await act(async () =>
    monitor().track({ id: 'transfer', status: 'PROCESSING', step: 'DONE', currency: 'USD', toCurrency: 'USD' }),
  );
  await act(async () =>
    pending[0](json(503, { message: 'Temporarily unavailable' })),
  );
  assert.match(monitor().error, /Temporarily unavailable/);
  await act(async () => t.mock.timers.tick(2000));
  assert.equal(pending.length, 2);
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () =>
    pending[1](json(200, { id: 'transfer', status: 'PROCESSING', step: 'DONE', currency: 'USD', toCurrency: 'USD' })),
  );
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(pending.length, 2);
});

test('a late response for the previous transfer cannot replace the current one', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const pending = [];
  t.mock.method(
    globalThis,
    'fetch',
    () => new Promise((resolve) => pending.push(resolve)),
  );
  const monitor = await mountMonitor();
  await act(async () => monitor().track({ id: 'first', status: 'PROCESSING', step: 'DONE', currency: 'USD', toCurrency: 'USD' }));
  await act(async () =>
    monitor().track({ id: 'second', status: 'PROCESSING', step: 'DONE', currency: 'USD', toCurrency: 'USD' }),
  );
  await act(async () =>
    pending[0](json(200, { id: 'first', status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' })),
  );
  assert.equal(monitor().transfer.id, 'second');
  assert.equal(monitor().transfer.status, 'PROCESSING');
  await act(async () =>
    pending[1](json(200, { id: 'second', status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' })),
  );
  assert.equal(monitor().transfer.status, 'COMPLETED');
});
