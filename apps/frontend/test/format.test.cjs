const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadSource } = require('./load-source.cjs');
test('money formatting preserves every digit beyond floating point precision', () => {
  const { money } = loadSource('lib/format.ts');
  assert.equal(money('1234567890123456.78').replace(/\s/g, ''), '1234567890123456.78');
  assert.equal(money('-1000000.01').replace(/\s/g, ''), '-1000000.01');
  assert.equal(money('0.00'), '0.00');
});

test('date labels match across server and browser timezones at midnight and DST', () => {
  const { dateLabel } = loadSource('lib/format.ts');
  const previous = process.env.TZ;
  try {
    for (const value of ['2030-01-01T23:30:00Z', '2030-03-31T00:30:00Z', '2030-10-27T01:30:00Z']) {
      const expected = new Intl.DateTimeFormat('uk-UA', {
        timeZone: 'Europe/Kyiv', day: 'numeric', month: 'short', year: 'numeric',
      }).format(new Date(value));
      for (const zone of ['UTC', 'Europe/Kyiv', 'America/Los_Angeles']) {
        process.env.TZ = zone;
        assert.equal(dateLabel(value), expected);
      }
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
