const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { loadSource } = require('./load-source.cjs');
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost:3000/admin' });
for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'FormData'])
  Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { renderToString } = require('react-dom/server');
const { hydrateRoot, createRoot } = require('react-dom/client');

const zones = ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Tokyo'];
const values = ['2030-01-01T23:30:00Z', '2030-03-31T00:30:00Z',
  '2030-03-31T01:30:00Z', '2030-10-27T00:30:00Z', '2030-10-27T01:30:00Z'];

function restoreZone(previous) {
  if (previous === undefined) delete process.env.TZ;
  else process.env.TZ = previous;
}

test('LocalTime hydrates UTC into each browser timezone without mismatches at midnight and DST', async () => {
  const { LocalTime } = loadSource('components/local-time.tsx');
  const previous = process.env.TZ;
  try {
    for (const zone of zones) for (const value of values) {
      const element = React.createElement(LocalTime, { value, format: 'datetime' });
      process.env.TZ = 'Pacific/Honolulu';
      const container = document.getElementById('root');
      container.innerHTML = renderToString(element);
      const options = { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' };
      assert.equal(container.textContent,
        new Intl.DateTimeFormat('uk-UA', { ...options, timeZone: 'UTC' }).format(new Date(value)));
      process.env.TZ = zone;
      const errors = [];
      let root;
      try {
        await act(async () => { root = hydrateRoot(container, element, {
          onRecoverableError: error => errors.push(error.message),
        }); });
        assert.deepEqual(errors, []);
        assert.equal(container.textContent, new Intl.DateTimeFormat('uk-UA', options).format(new Date(value)));
        assert.equal(container.querySelector('time').dateTime, value);
      } finally { if (root) await act(async () => root.unmount()); }
    }
  } finally { restoreZone(previous); }
});

test('relative days use the browser calendar across short and long days', (t) => {
  const { formatLocalTime } = loadSource('components/local-time.tsx');
  const previous = process.env.TZ;
  try {
    for (const zone of zones) for (const day of ['2030-04-01', '2030-10-28']) {
      process.env.TZ = zone;
      const today = new Date(`${day}T00:30:00`);
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 10);
      t.mock.timers.enable({ apis: ['Date'], now: today });
      try {
        assert.equal(formatLocalTime(today.toISOString(), 'day', true), 'Сьогодні');
        assert.equal(formatLocalTime(yesterday.toISOString(), 'day', true), 'Вчора');
        assert.notEqual(formatLocalTime(today.toISOString(), 'day', false), 'Сьогодні');
      } finally { t.mock.timers.reset(); }
    }
  } finally { restoreZone(previous); }
});

test('calendar submits inclusive local days as UTC boundaries and restores the selected days', async () => {
  const previous = process.env.TZ;
  try {
    for (const [zone, day, start, end] of [
      ['Europe/Berlin', '2030-03-31', '2030-03-30T23:00:00.000Z', '2030-03-31T22:00:00.000Z'],
      ['Europe/Berlin', '2030-10-27', '2030-10-26T22:00:00.000Z', '2030-10-27T23:00:00.000Z'],
      ['America/New_York', '2030-03-10', '2030-03-10T05:00:00.000Z', '2030-03-11T04:00:00.000Z'],
      ['America/New_York', '2030-11-03', '2030-11-03T04:00:00.000Z', '2030-11-04T05:00:00.000Z'],
      ['UTC', '2030-12-31', '2030-12-31T00:00:00.000Z', '2031-01-01T00:00:00.000Z'],
      ['Asia/Tokyo', '2030-02-01', '2030-01-31T15:00:00.000Z', '2030-02-01T15:00:00.000Z'],
    ]) {
      process.env.TZ = zone;
      let destination;
      const { PeriodFilter } = loadSource('app/admin/period-filter.tsx', {
        'next/navigation': { useRouter: () => ({ push: value => { destination = value; } }) },
      });
      const root = createRoot(document.getElementById('root'));
      try {
        await act(async () => root.render(React.createElement(PeriodFilter, { walletId: 'wallet', from: start, to: end })));
        assert.equal(document.querySelector('[name=from]').type, 'date');
        assert.equal(document.querySelector('[name=from]').value, day);
        assert.equal(document.querySelector('[name=to]').value, day);
        await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
        const query = new URL(destination, window.location.origin).searchParams;
        assert.equal(query.get('from'), start);
        assert.equal(query.get('to'), end);
        assert.equal(query.get('walletId'), 'wallet');
        document.querySelector('[name=from]').value = '';
        document.querySelector('[name=to]').value = '';
        await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(destination, '/admin?walletId=wallet');
      } finally { await act(async () => root.unmount()); }
    }
  } finally { restoreZone(previous); }
});

test('activity groups hydrate from UTC into local calendar days together with their times', async (t) => {
  const previous = process.env.TZ;
  const items = [
    { id: 'first', type: 'DEPOSIT', createdAt: '2030-01-01T23:30:00Z', payload: {} },
    { id: 'second', type: 'DEPOSIT', createdAt: '2030-01-02T00:30:00Z', payload: {} },
  ];
  t.mock.method(globalThis, 'fetch', async () => Response.json(items));
  const { ActivityFeed } = loadSource('app/activity/activity-feed.tsx', {
    '@/lib/use-live-socket': { useLiveSocket: () => 'offline' },
  });
  const element = React.createElement(ActivityFeed, { initial: items, initialError: null });
  let root;
  try {
    process.env.TZ = 'UTC';
    const container = document.getElementById('root');
    container.innerHTML = renderToString(element);
    assert.equal(container.querySelectorAll('section').length, 2);
    process.env.TZ = 'Asia/Tokyo';
    const errors = [];
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError: error => errors.push(error.message) }); });
    assert.deepEqual(errors, []);
    assert.equal(container.querySelectorAll('section').length, 1);
    assert.match(container.querySelector('h2').textContent, /2 січ/);
    assert.deepEqual([...container.querySelectorAll('time')].slice(1).map(time => time.textContent), ['08:30', '09:30']);
  } finally {
    if (root) await act(async () => root.unmount());
    restoreZone(previous);
  }
});
