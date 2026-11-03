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

test('unknown API statuses, steps, currencies and modes fail explicitly', () => {
  const { validateApiState, validTransferUpdate } = loadSource('lib/types.ts');
  for (const [path, value] of [
    ['/transfers/id', { status: 'COMPELTED' }], ['/transfers/id', { step: 'RESERVE' }],
    ['/wallets', [{ currency: 'GBP' }]], ['/split-bills/id', { mode: 'RANDOM' }],
    ['/split-bills/id', { shares: [{ status: 'SETTLED' }] }],
  ]) assert.throws(() => validateApiState(path, value), /невідомий стан/);
  assert.equal(validTransferUpdate({ status: 'FUTURE', step: 'DONE' }), false);
});

test('split payment decodes its transfer response rather than a bill status', () => {
  const { validateApiState } = loadSource('lib/types.ts');
  assert.doesNotThrow(() => validateApiState('/split-bills/bill/shares/share/pay', { status: 'COMPLETED', step: 'DONE', currency: 'USD', toCurrency: 'USD' }));
});
