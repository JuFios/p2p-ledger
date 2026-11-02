const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');
const dom = new JSDOM('<div id="root"></div>', {
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
const wallet = {
  id: '11111111-1111-4111-8111-111111111111',
  currency: 'USD',
  balance: '100.00',
  available: '100.00',
  held: '0.00',
  frozen: false,
};
const bill = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  title: 'Dinner',
  creatorEmail: 'creator@example.com',
  totalAmount: '10.00',
  currency: 'USD',
  status: 'PENDING',
  mode: 'EQUAL',
  dueAt: null,
  shares: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      participantEmail: 'user@example.com',
      amount: '10.00',
      status: 'ACCEPTED',
    },
  ],
};
const complete = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  status: 'COMPLETED',
  step: 'DONE',
  amount: '10.00',
  currency: 'USD',
  toAmount: '10.00',
  toCurrency: 'USD',
  recipientEmail: 'creator@example.com',
  failureReason: null,
};
const live = { '@/lib/use-live-socket': { useLiveSocket: () => 'online' } };
let root;
beforeEach(() => {
  window.sessionStorage.clear();
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
});
async function mount(Component, props) {
  await act(async () => root.render(React.createElement(Component, props)));
}
async function remount(Component, props) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await mount(Component, props);
}
async function submit(form) {
  await act(async () =>
    form.dispatchEvent(
      new dom.window.Event('submit', { bubbles: true, cancelable: true }),
    ),
  );
}
const json = (status, body) => Response.json(body, { status });
function button(text) {
  return [...container.querySelectorAll('button')].find(
    (b) => b.textContent === text,
  );
}
test('transfer remount retries the same key and body and clears storage on final status', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    if (init?.method === 'POST') {
      calls.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: init.body,
      });
      return calls.length === 1
        ? json(503, { message: 'uncertain' })
        : json(200, complete);
    }
    return json(200, [wallet]);
  });
  const { TransferForm } = loadSource(
    'app/transfers/new/transfer-form.tsx',
    live,
  );
  const props = { initialWallets: [wallet], initialError: null };
  await mount(TransferForm, props);
  container.querySelector('[name=email]').value = 'creator@example.com';
  container.querySelector('[name=amount]').value = '10';
  await submit(container.querySelector('form'));
  await remount(TransferForm, props);
  await submit(container.querySelector('form'));
  assert.ok(calls[0].key);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(window.sessionStorage.length, 0);
});
test('wallet remount preserves an uncertain mutation and clears it after success', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST') {
      calls.push({
        url,
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: init.body,
      });
      return calls.length === 1
        ? json(503, { message: 'uncertain' })
        : json(201, wallet);
    }
    return json(200, [wallet]);
  });
  const { Wallets } = loadSource('app/wallets/wallets.tsx', live);
  const props = { initial: [wallet], initialError: null };
  await mount(Wallets, props);
  container.querySelector('[name=amount]').value = '10';
  await submit(container.querySelector('form'));
  await remount(Wallets, props);
  const retry = button('Повторити попередній запит');
  assert.ok(retry);
  await act(async () => retry.click());
  assert.ok(calls[0].key);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(window.sessionStorage.length, 0);
});
test('share payment remount preserves its key and clears it when the share is paid', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (init?.method === 'POST') {
      calls.push({
        key: new Headers(init.headers).get('Idempotency-Key'),
        body: init.body,
      });
      return calls.length === 1
        ? json(503, { message: 'uncertain' })
        : json(200, complete);
    }
    return json(
      200,
      String(url).includes('/wallets')
        ? [wallet]
        : {
            ...bill,
            shares: [
              {
                ...bill.shares[0],
                status: calls.length > 1 ? 'PAID' : 'ACCEPTED',
              },
            ],
          },
    );
  });
  const { BillDetails } = loadSource('app/split-bills/[id]/bill-details.tsx', {
    ...live,
    '../actions': { acceptShare: async () => ({}) },
  });
  const props = {
    initial: bill,
    initialWallets: [wallet],
    email: 'user@example.com',
    initialError: null,
  };
  await mount(BillDetails, props);
  await submit(container.querySelector('form'));
  await remount(BillDetails, props);
  await submit(container.querySelector('form'));
  assert.ok(calls[0].key);
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(window.sessionStorage.length, 0);
});
test('bill creation remount restores FormData with the same key and clears it after creation', async () => {
  const calls = [],
    pushes = [];
  const { CreateBillForm } = loadSource('app/split-bills/create-form.tsx', {
    'next/navigation': {
      useRouter: () => ({ push: (path) => pushes.push(path) }),
    },
    './actions': {
      createBill: async (data) => {
        calls.push([...data.entries()]);
        return calls.length === 1
          ? { error: 'uncertain', status: 503 }
          : { id: bill.id };
      },
    },
  });
  await mount(CreateBillForm, {});
  container.querySelector('[name=title]').value = 'Dinner';
  container.querySelector('[name=totalAmount]').value = '10';
  container.querySelector('[name=participants]').value = 'friend@example.com';
  await submit(container.querySelector('form'));
  await remount(CreateBillForm, {});
  await submit(container.querySelector('form'));
  assert.deepEqual(calls[1], calls[0]);
  assert.equal(window.sessionStorage.length, 0);
  assert.deepEqual(pushes, [`/split-bills/${bill.id}`]);
});
test('blocked session storage keeps the existing in-memory retry behavior', async (t) => {
  const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    get() {
      throw new Error('storage blocked');
    },
  });
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls.push(new Headers(init.headers).get('Idempotency-Key'));
    return calls.length === 1
      ? json(503, { message: 'uncertain' })
      : json(200, complete);
  });
  try {
    const { TransferForm } = loadSource(
      'app/transfers/new/transfer-form.tsx',
      live,
    );
    await mount(TransferForm, { initialWallets: [wallet], initialError: null });
    container.querySelector('[name=email]').value = 'creator@example.com';
    container.querySelector('[name=amount]').value = '10';
    await submit(container.querySelector('form'));
    await submit(container.querySelector('form'));
    assert.ok(calls[0]);
    assert.equal(calls[1], calls[0]);
  } finally {
    Object.defineProperty(window, 'sessionStorage', original);
  }
});
