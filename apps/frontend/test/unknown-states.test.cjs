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
const wallet = { id: 'wallet', currency: 'USD', balance: '10.00', available: '10.00', held: '0.00', frozen: false };
const bill = { id: 'bill', title: 'Вечеря', creatorEmail: 'owner@example.com', totalAmount: '1.00',
  currency: 'USD', mode: 'CUSTOM', status: 'PENDING', dueAt: null,
  shares: [{ id: 'share', participantEmail: 'user@example.com', amount: '1.00', status: 'ACCEPTED' }] };

for (const value of [
  { ...bill, status: 'ARCHIVED' },
  { ...bill, shares: [{ ...bill.shares[0], status: 'SETTLED' }] },
  { ...bill, shares: [{ ...bill.shares[0], status: 'PENDING' },
    { id: 'other', participantEmail: 'other@example.com', amount: '1.00', status: 'REVIEW' }] },
]) {
  test(`split displays new state ${value.status}/${value.shares.at(-1).status} and prevents payment and acceptance`, async (t) => {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (...args) => { requests.push(args); throw new Error('unexpected request'); });
    window.sessionStorage.clear();
    const { attemptScope, writeAttempt } = loadSource('lib/attempt-storage.ts');
    writeAttempt(attemptScope('user', 'split-pay:bill:share'), {
      key: 'saved-key', shareId: 'share', body: JSON.stringify({ fromWalletId: wallet.id }),
    });
    const { BillDetails } = loadSource('app/split-bills/[id]/bill-details.tsx', {
      '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
      '../actions': { acceptShare: async () => { requests.push('accept'); return {}; } },
    });
    const root = createRoot(document.getElementById('root'));
    try {
      await act(async () => root.render(React.createElement(BillDetails, {
        userId: 'user', email: 'user@example.com', initial: value, initialWallets: [wallet], initialError: null,
      })));
      const unknown = value.status === 'ARCHIVED' ? 'ARCHIVED' : value.shares.at(-1).status;
      assert.match(document.body.textContent, new RegExp(unknown));
      assert.match(document.body.textContent, /Оплату й підтвердження вимкнено/);
      for (const button of document.querySelectorAll('button')) {
        if (/Підтвердити|оплату|Сплатити/.test(button.textContent)) {
          assert.equal(button.disabled, true);
          await act(async () => button.click());
        }
      }
      const form = document.querySelector('form');
      if (form) await act(async () => form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(requests.length, 0);
    } finally { await act(async () => root.unmount()); window.sessionStorage.clear(); }
  });
}

test('unknown transfer states show raw values without claiming a successful or active step', async () => {
  const { parseTransfer, isFinal } = loadSource('lib/types.ts');
  const { TransferProgress } = loadSource('components/transfer-progress.tsx');
  const root = createRoot(document.getElementById('root'));
  try {
    for (const states of [{ status: 'REVIEW', step: 'HOLD' }, { status: 'COMPLETED', step: 'FUTURE' }]) {
      const transfer = parseTransfer({ id: 'transfer', ...states, amount: '1.00', currency: 'USD',
        toAmount: null, toCurrency: 'USD', recipientEmail: 'user@example.com', failureReason: null });
      assert.equal(isFinal(transfer), false);
      await act(async () => root.render(React.createElement(TransferProgress, { transfer })));
      assert.match(document.body.textContent, new RegExp(states.status));
      assert.match(document.body.textContent, new RegExp(states.step));
      assert.equal(document.querySelector('[aria-current=step]'), null);
      assert.doesNotMatch(document.body.textContent, /Кошти зараховано отримувачу|Переказ завершено/);
    }
    const { statusLabel } = loadSource('lib/format.ts');
    assert.equal(statusLabel('toString'), 'toString');
  } finally { await act(async () => root.unmount()); }
});
