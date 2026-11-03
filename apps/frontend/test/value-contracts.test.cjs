const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');

test('frontend money limit matches the public contract and guards its boundary', () => {
  const { MAX_AMOUNT, money } = loadSource('lib/validation.ts');
  const contract = loadSource('../../contracts/is-money-amount.ts', {
    'class-validator': { registerDecorator() {} },
  });
  assert.equal(MAX_AMOUNT, contract.MAX_AMOUNT);
  for (const value of ['0.01', '0.29', String(MAX_AMOUNT)]) {
    assert.equal(money(value), Number(value));
    assert.equal(contract.isMoneyAmount(Number(value)), true);
  }
  for (const value of ['0', '-1', '0.001', String(MAX_AMOUNT + 0.01)]) {
    assert.throws(() => money(value), new RegExp(String(MAX_AMOUNT)));
    assert.equal(contract.isMoneyAmount(Number(value)), false);
  }
});

test('server URLs are read once with local defaults and environment overrides', () => {
  const previous = { BFF_URL: process.env.BFF_URL, WS_PUBLIC_URL: process.env.WS_PUBLIC_URL };
  try {
    delete process.env.BFF_URL;
    delete process.env.WS_PUBLIC_URL;
    const defaults = loadSource('lib/server-config.ts');
    assert.equal(defaults.BFF_URL, 'http://localhost:3004');
    assert.equal(defaults.WS_PUBLIC_URL, 'http://localhost:3003');
    process.env.BFF_URL = 'http://bff.test:4004';
    process.env.WS_PUBLIC_URL = 'http://socket.test:4003';
    const configured = loadSource('lib/server-config.ts');
    process.env.BFF_URL = 'http://changed.test';
    process.env.WS_PUBLIC_URL = 'http://changed.test';
    assert.equal(configured.BFF_URL, 'http://bff.test:4004');
    assert.equal(configured.WS_PUBLIC_URL, 'http://socket.test:4003');
    assert.equal(defaults.BFF_URL, 'http://localhost:3004');
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
