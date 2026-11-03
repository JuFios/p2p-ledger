const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'FormData'])
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

test('UTF-8 session email identifies the signed-in split participant', async () => {
  const email = 'олена@example.com';
  const { sessionClaims } = loadSource('lib/session.ts');
  const token = `header.${Buffer.from(JSON.stringify({ sub: 'user', exp: 2000000000, email })).toString('base64url')}.signature`;
  const claims = sessionClaims(token);
  assert.equal(claims.email, email);
  const { BillDetails } = loadSource('app/split-bills/[id]/bill-details.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
    '../actions': { acceptShare: async () => ({}) },
  });
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(BillDetails, {
      userId: 'user', email: claims.email, initialError: null, initialWallets: [],
      initial: { id: 'bill', title: 'Вечеря', creatorEmail: 'owner@example.com', totalAmount: '1.00', currency: 'USD', mode: 'CUSTOM', status: 'PENDING', dueAt: null,
        shares: [{ id: 'share', participantEmail: email, amount: '1.00', status: 'PENDING' }] },
    })));
    assert.match(document.body.textContent, /Підтвердити свою частку/);
  } finally { await act(async () => root.unmount()); }
});

for (const staleFailure of [false, true]) {
  test(`transfer reload ignores an older ${staleFailure ? 'error' : 'balance'} after a newer response`, async (t) => {
    let handlers;
    const pending = [];
    t.mock.method(globalThis, 'fetch', async () => new Promise(resolve => pending.push(resolve)));
    const wallet = { id: 'wallet', currency: 'USD', balance: '100.00', available: '100.00', held: '0.00', frozen: false };
    const { TransferForm } = loadSource('app/transfers/new/transfer-form.tsx', {
      '@/lib/use-live-socket': { useLiveSocket: value => { handlers = value; return 'online'; } },
    });
    const root = createRoot(document.getElementById('root'));
    try {
      await act(async () => root.render(React.createElement(TransferForm, { userId: 'user', initialWallets: [wallet], initialError: null })));
      let first;
      await act(async () => { first = handlers.onConnect(); handlers.onWallet({ walletId: wallet.id }); });
      await act(async () => pending[1](Response.json([{ ...wallet, balance: '80.00', available: '80.00' }])));
      await act(async () => {
        pending[0](staleFailure ? Response.json({ message: 'old error' }, { status: 503 }) : Response.json([wallet]));
        await first;
      });
      assert.match(document.querySelector('select').textContent, /80\.00/);
      assert.doesNotMatch(document.body.textContent, /old error/);
    } finally { await act(async () => root.unmount()); }
  });
}

test('response parsers reject unknown states and unexpected response shapes', () => {
  const { parseWallet, parseTransfer, parseBill, parseList, validTransferUpdate } = loadSource('lib/types.ts');
  const transfer = { status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' };
  const bill = { status: 'PENDING', mode: 'CUSTOM', currency: 'USD', shares: [] };
  for (const value of [
    { ...transfer, status: 'COMPELTED' }, { ...transfer, step: 'RESERVE' },
    { ...transfer, currency: 'GBP' }, { ...transfer, toCurrency: 'GBP' },
  ]) assert.throws(() => parseTransfer(value), /невідомий стан/);
  assert.throws(() => parseWallet({ currency: 'GBP' }), /невідомий стан/);
  assert.throws(() => parseBill({ ...bill, mode: 'RANDOM' }), /невідомий стан/);
  assert.throws(() => parseBill({ ...bill, shares: [{ status: 'SETTLED' }] }), /невідомий стан/);
  for (const value of [null, undefined, { items: [] }]) {
    assert.throws(() => parseList(parseWallet)(value), /некоректний список/);
    assert.throws(() => parseTransfer(value));
  }
  assert.equal(validTransferUpdate({ status: 'FUTURE', step: 'DONE' }), false);
});

test('split payment explicitly parses its transfer response', async (t) => {
  const { parseTransfer } = loadSource('lib/types.ts');
  const { clientFetch } = loadSource('lib/http.ts');
  const transfer = { status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' };
  t.mock.method(globalThis, 'fetch', async () => Response.json(transfer));
  assert.deepEqual(await clientFetch('/split-bills/bill/shares/share/pay', undefined, parseTransfer), transfer);
});

test('BillDetails hydrates UTC markup then displays the browser due date', async () => {
  const { renderToString } = require('react-dom/server');
  const { hydrateRoot } = require('react-dom/client');
  const { BillDetails } = loadSource('app/split-bills/[id]/bill-details.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
    '../actions': { acceptShare: async () => ({}) },
  });
  const element = React.createElement(BillDetails, {
    userId: 'user', email: 'owner@example.com', initialError: null, initialWallets: [],
    initial: { id: 'bill', title: 'Вечеря', creatorEmail: 'owner@example.com', totalAmount: '1.00', currency: 'USD', mode: 'CUSTOM', status: 'PENDING', dueAt: '2030-01-01T23:30:00Z', shares: [] },
  });
  const previous = process.env.TZ;
  let root;
  const errors = [];
  try {
    process.env.TZ = 'UTC';
    const container = document.getElementById('root');
    container.innerHTML = renderToString(element);
    const serverText = container.textContent;
    process.env.TZ = 'Europe/Berlin';
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error.message) });
    });
    assert.deepEqual(errors, []);
    assert.match(serverText, /1 січ/);
    assert.match(container.textContent, /2 січ/);
    assert.notEqual(container.textContent, serverText);
  } finally {
    if (root) await act(async () => root.unmount());
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
