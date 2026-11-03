const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, dirname } = require('node:path');
const root = resolve(__dirname, '..');
const check = process.argv.includes('--check');
let stale = false;
function sync(source, target, parameters = {}) {
  let value = readFileSync(resolve(root, source), 'utf8');
  for (const [name, replacement] of Object.entries(parameters)) value = value.replaceAll(`@@${name}@@`, replacement);
  const file = resolve(root, target);
  let current;
  try { current = readFileSync(file, 'utf8'); } catch {}
  if (current === value) return;
  if (check) { console.error(`Contract copy differs: ${target}; run node scripts/sync-contracts.cjs`); stale = true; }
  else { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); }
}
for (const service of ['bff', 'ledger-service', 'payments-service']) {
  sync('contracts/is-money-amount.ts', `apps/${service}/src/${service === 'ledger-service' ? 'wallets/dto' : 'common'}/is-money-amount.ts`);
}
for (const service of ['bff', 'ledger-service']) sync('contracts/is-calendar-date.ts', `apps/${service}/src/common/is-calendar-date.ts`);
for (const [service, prefix, lock] of [['ledger-service', 'LEDGER', '0x6c656467'], ['payments-service', 'PAYMENTS', '0x7061796d']]) {
  sync('contracts/outbox-relay.service.ts.template', `apps/${service}/src/outbox/outbox-relay.service.ts`, {
    STREAM_CONSTANT: `${prefix}_EVENTS_STREAM`, STREAM: `stream:${prefix.toLowerCase()}-events`, LOCK: lock, PRODUCER: service,
  });
}
for (const service of ['bff', 'payments-service']) sync('contracts/http-budget.ts', `apps/${service}/src/common/http-budget.ts`);
sync('contracts/http-budget.ts', 'apps/frontend/lib/http-budget.ts');
for (const service of ['bff', 'ledger-service', 'payments-service']) sync('contracts/money-contract.spec.ts.template', `apps/${service}/test/money-contract.spec.ts`, { MONEY_IMPORT: `../src/${service === 'ledger-service' ? 'wallets/dto' : 'common'}/is-money-amount` });
for (const service of ['ledger-service', 'payments-service']) sync('contracts/outbox-contract.spec.ts', `apps/${service}/test/outbox-contract.spec.ts`);
for (const service of ['bff', 'ledger-service', 'payments-service', 'notifications-service']) sync('contracts/config-policy.ts', `apps/${service}/src/config/config-policy.ts`);
for (const service of ['bff', 'ledger-service', 'payments-service', 'notifications-service']) sync('contracts/config-policy.spec.ts', `apps/${service}/test/config-policy.spec.ts`);
if (stale) process.exitCode = 1;
