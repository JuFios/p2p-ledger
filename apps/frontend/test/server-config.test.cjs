const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');

test('server timeout configuration is validated on module load and stays stable', () => {
  const previous = process.env.CB_TIMEOUT_MS;
  try {
    delete process.env.CB_TIMEOUT_MS;
    assert.equal(loadSource('lib/server-config.ts').FRONTEND_TIMEOUT_MS, 8000);
    for (const value of ['', ' ', '0', '-1', '1.5', '60001', 'NaN']) {
      process.env.CB_TIMEOUT_MS = value;
      assert.throws(() => loadSource('lib/server-config.ts'), /CB_TIMEOUT_MS/);
    }
    process.env.CB_TIMEOUT_MS = '6000';
    const config = loadSource('lib/server-config.ts');
    process.env.CB_TIMEOUT_MS = '';
    assert.equal(config.FRONTEND_TIMEOUT_MS, 11000);
  } finally {
    if (previous === undefined) delete process.env.CB_TIMEOUT_MS;
    else process.env.CB_TIMEOUT_MS = previous;
  }
});
