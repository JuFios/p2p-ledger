const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');

const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement']) {
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

test('activity shows credited FX amounts to recipients and debited amounts to senders', async (t) => {
  const transfer = { amount: '10.00', currency: 'USD', toAmount: '9.20', toCurrency: 'EUR' };
  const entries = [
    ['TRANSFER_RECEIVED', transfer],
    ['TRANSFER_SENT', transfer],
    ['TRANSFER_RECEIVED', { amount: '5.00', currency: 'USD', toAmount: '5.00', toCurrency: 'USD' }],
    ['DEPOSIT', { amount: '1.23', currency: 'UAH' }],
    ['WITHDRAWAL', { amount: '2.34', currency: 'EUR' }],
  ].map(([type, payload], index) => ({
    id: String(index), type, payload, createdAt: '2026-11-03T12:00:00Z',
  }));
  t.mock.method(globalThis, 'fetch', async () => Response.json(entries));
  const { ActivityFeed } = loadSource('app/activity/activity-feed.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
  });
  const container = document.getElementById('root');
  const root = createRoot(container);
  try {
    await act(async () => root.render(React.createElement(ActivityFeed, {
      initial: entries, initialError: null,
    })));
    const text = container.textContent.replace(/\s+/g, ' ');
    for (const amount of ['+9.20 EUR', '−10.00 USD', '+5.00 USD', '+1.23 UAH', '−2.34 EUR']) {
      assert(text.includes(amount), `Missing activity amount ${amount}`);
    }
    assert(!text.includes('+10.00 USD'));
  } finally {
    await act(async () => root.unmount());
  }
});
