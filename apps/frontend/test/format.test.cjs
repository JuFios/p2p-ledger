const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');
test('money formatting preserves every digit beyond floating point precision', () => {
  const { money } = loadSource('lib/format.ts');
  assert.equal(money('1234567890123456.78').replace(/\s/g, ''), '1234567890123456.78');
  assert.equal(money('-1000000.01').replace(/\s/g, ''), '-1000000.01');
  assert.equal(money('0.00'), '0.00');
});
