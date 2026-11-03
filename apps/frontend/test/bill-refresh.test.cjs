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
const bill = {
  id: 'bill', title: 'Dinner', creatorEmail: 'owner@example.com',
  totalAmount: '2.00', currency: 'USD', mode: 'EQUAL', status: 'PENDING', dueAt: null,
  shares: ['alice', 'bob'].map(id => ({
    id, participantEmail: `${id}@example.com`, amount: '1.00', status: 'PAYING',
  })),
};
const paid = {
  ...bill, status: 'PARTIALLY_PAID',
  shares: [{ ...bill.shares[0], status: 'PAID' }, bill.shares[1]],
};

async function mount(t, props = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const requests = [];
  let handlers;
  const monitor = { transfer: null, error: null, refreshes: 0,
    refresh: async () => { monitor.refreshes++; }, update() {}, track() {} };
  t.mock.method(globalThis, 'fetch', (url) => new Promise(resolve => requests.push({ url, resolve })));
  const { BillDetails } = loadSource('app/split-bills/[id]/bill-details.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: value => { handlers = value; return 'online'; } },
    '@/lib/use-transfer': { useTransfer: () => monitor },
    '../actions': { acceptShare: async () => ({}) },
  });
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(BillDetails, {
    userId: 'owner', email: bill.creatorEmail, initial: bill, initialWallets: [], initialError: null,
    ...props,
  })));
  t.after(async () => { await act(async () => root.unmount()); });
  return { requests, handlers, root, monitor };
}
const resolve = (request, value, status = 200) => act(async () => request.resolve(Response.json(value, { status })));

test('a slow bill poll stays single-flight and schedules again after completion', async t => {
  const { requests } = await mount(t);
  await act(async () => t.mock.timers.tick(2000));
  assert.equal(requests.length, 1);
  await act(async () => t.mock.timers.tick(6000));
  assert.equal(requests.length, 1);
  await resolve(requests[0], paid);
  assert.match(document.body.textContent, /Сплачено 1 із 2/);
  await act(async () => t.mock.timers.tick(2000));
  assert.equal(requests.length, 2);
  const settled = { ...paid, status: 'SETTLED', shares: paid.shares.map(s => ({ ...s, status: 'PAID' })) };
  await resolve(requests[1], settled);
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(requests.length, 2);
});

for (const staleError of [false, true]) {
  test(`a late bill poll cannot overwrite a newer live refresh with ${staleError ? 'an error' : 'old shares'}`, async t => {
    const { requests, handlers } = await mount(t);
    await act(async () => t.mock.timers.tick(2000));
    let refresh;
    await act(async () => { refresh = handlers.onConnect(); });
    await resolve(requests[1], paid);
    await resolve(requests[2], []);
    await act(async () => refresh);
    await resolve(requests[0], staleError ? { message: 'obsolete poll failure' } : bill, staleError ? 503 : 200);
    assert.match(document.body.textContent, /Сплачено 1 із 2/);
    assert.doesNotMatch(document.body.textContent, /obsolete poll failure/);
  });
}

test('background polling waits for a slow full refresh', async t => {
  const { requests, handlers } = await mount(t);
  let refresh;
  await act(async () => { refresh = handlers.onConnect(); });
  await act(async () => t.mock.timers.tick(6000));
  assert.equal(requests.length, 2);
  await resolve(requests[0], paid);
  await resolve(requests[1], []);
  await act(async () => refresh);
  assert.match(document.body.textContent, /Сплачено 1 із 2/);
  await act(async () => t.mock.timers.tick(2000));
  assert.equal(requests.length, 3);
});

test('a newer manual refresh wins over an older refresh completed last', async t => {
  const { requests, handlers } = await mount(t);
  let first;
  await act(async () => { first = handlers.onConnect(); });
  await act(async () => [...document.querySelectorAll('button')]
    .find(button => button.textContent === 'Оновити рахунок').click());
  await resolve(requests[2], paid);
  await resolve(requests[3], []);
  await resolve(requests[0], bill);
  await resolve(requests[1], []);
  await act(async () => first);
  assert.match(document.body.textContent, /Сплачено 1 із 2/);
});

test('polling recovers from a failure without fetching wallets', async t => {
  const { requests } = await mount(t);
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[0], { message: 'temporary bill failure' }, 503);
  assert.match(document.body.textContent, /temporary bill failure/);
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[1], paid);
  assert.match(document.body.textContent, /Сплачено 1 із 2/);
  assert.doesNotMatch(document.body.textContent, /temporary bill failure/);
  assert(requests.every(r => String(r.url).endsWith('/split-bills/bill')));
});

test('unmount prevents a pending refresh from continuing transfer work', async t => {
  const { requests, handlers, root, monitor } = await mount(t);
  let refresh;
  await act(async () => { refresh = handlers.onConnect(); });
  await act(async () => root.render(null));
  await resolve(requests[0], bill);
  await resolve(requests[1], []);
  await act(async () => refresh);
  await act(async () => t.mock.timers.tick(10000));
  assert.equal(document.getElementById('root').textContent, '');
  assert.equal(requests.length, 2);
  assert.equal(monitor.refreshes, 0);
});

const accepted = { ...bill, shares: [{ ...bill.shares[0], status: 'ACCEPTED' }, bill.shares[1]] };
const wallet = { id: 'alice-wallet', currency: 'USD', balance: '5.00', available: '5.00', held: '0.00', frozen: false };
const button = text => [...document.querySelectorAll('button')].find(value => value.textContent === text);

test('bill polling preserves an initial wallet failure and its retry action', async t => {
  const { requests } = await mount(t, {
    userId: 'alice', email: 'alice@example.com', initial: accepted, initialError: 'wallets unavailable',
  });
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[0], { message: 'temporary poll failure' }, 503);
  assert.match(document.body.textContent, /wallets unavailable/);
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[1], accepted);
  assert.match(document.body.textContent, /wallets unavailable/);
  assert(button('Спробувати ще раз'));
  assert.equal(document.querySelector('select').options.length, 0);
  assert.equal(button('Сплатити свою частку').disabled, true);
  assert(requests.every(r => String(r.url).endsWith('/split-bills/bill')));
});

test('a failed wallet refresh survives bill polling until a full retry succeeds', async t => {
  const { requests, handlers } = await mount(t, {
    userId: 'alice', email: 'alice@example.com', initial: accepted,
  });
  let refresh;
  await act(async () => { refresh = handlers.onConnect(); });
  await resolve(requests[0], accepted);
  await resolve(requests[1], { message: 'wallet refresh failed' }, 503);
  await act(async () => refresh);
  assert.match(document.body.textContent, /wallet refresh failed/);
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[2], accepted);
  assert.match(document.body.textContent, /wallet refresh failed/);
  assert(button('Спробувати ще раз'));
  await act(async () => button('Спробувати ще раз').click());
  assert(String(requests[3].url).endsWith('/split-bills/bill'));
  assert(String(requests[4].url).endsWith('/wallets'));
  await resolve(requests[3], accepted);
  assert.match(document.body.textContent, /wallet refresh failed/);
  await resolve(requests[4], [wallet]);
  assert.doesNotMatch(document.body.textContent, /wallet refresh failed/);
  assert.equal(button('Спробувати ще раз'), undefined);
  assert.equal(document.querySelector('select').value, wallet.id);
  assert.equal(button('Сплатити свою частку').disabled, false);
  assert.doesNotMatch(document.body.textContent, /Відкрийте гаманець/);
});

test('a full retry clears a polling failure even when polling stops', async t => {
  const { requests } = await mount(t);
  await act(async () => t.mock.timers.tick(2000));
  await resolve(requests[0], { message: 'poll unavailable' }, 503);
  assert.match(document.body.textContent, /poll unavailable/);
  await act(async () => button('Спробувати ще раз').click());
  const settled = { ...paid, status: 'SETTLED', shares: paid.shares.map(s => ({ ...s, status: 'PAID' })) };
  await resolve(requests[1], settled);
  await resolve(requests[2], []);
  assert.doesNotMatch(document.body.textContent, /poll unavailable/);
  assert.equal(button('Спробувати ще раз'), undefined);
  await act(async () => t.mock.timers.tick(6000));
  assert.equal(requests.length, 3);
});
