const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { EventEmitter } = require('node:events');
const { loadSource } = require('./load-source.cjs');
const dom = new JSDOM('<div id="root"></div>', {
  url: 'http://localhost:3000',
});
for (const name of ['window', 'document', 'navigator', 'HTMLElement'])
  Object.defineProperty(globalThis, name, {
    value: dom.window[name],
    configurable: true,
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
test('server expiry reconnects with a fresh handshake and restores state on connect', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = new EventEmitter();
  const tokens = [];
  let options,
    reads = 0,
    handshakes = 0;
  t.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      url: 'http://localhost:3003',
      token: `token-${++handshakes}`,
    }),
  );
  socket.connect = () => {
    options.auth(({ token }) => {
      tokens.push(token);
      socket.emit('connect');
    });
    return socket;
  };
  socket.disconnect = () => socket.emit('disconnect', 'io client disconnect');
  const { useLiveSocket } = loadSource('lib/use-live-socket.ts', {
    'socket.io-client': {
      io: (_url, opts) => {
        options = opts;
        return socket;
      },
    },
  });
  function App() {
    const status = useLiveSocket({ onConnect: () => reads++ });
    return React.createElement('p', null, status);
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(App)));
    assert.equal(reads, 1);
    await act(async () => socket.emit('disconnect', 'io server disconnect'));
    await act(async () => t.mock.timers.tick(3000));
    assert.equal(reads, 2);
    assert.notEqual(tokens[0], tokens[1]);
    assert.match(document.body.textContent, /online/);
  } finally {
    await act(async () => root.unmount());
  }
});
