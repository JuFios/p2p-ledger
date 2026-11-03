const { readFileSync, readdirSync } = require('node:fs');
const { resolve, relative } = require('node:path');

const root = resolve(__dirname, '..');
// Перевіряємо виконуваний код і джерела контрактів; документація та dev-env
// містять навмисні приклади. Тестові фікстури не задають runtime-політику.
const roots = [
  'apps/bff/src', 'apps/ledger-service/src', 'apps/payments-service/src',
  'apps/notifications-service/src', 'apps/frontend/app', 'apps/frontend/lib',
  'apps/frontend/components', 'apps/frontend/middleware.ts', 'contracts',
];
const rules = {
  timezone: /Europe\/Kyiv/g,
  loopback: /\blocalhost\s*:|\b127\.0\.0\.1\b/g,
  amount: /\b1(?:[ _]?0){6}\b/g,
  placeholder: /change-me-/g,
  currencies: /\[\s*(?=[^\]]*['"](?:USD|EUR|UAH)['"])(['"])[A-Z]{3}\1(?:\s*,\s*(['"])[A-Z]{3}\2)*\s*,?\s*\]/g,
};
// Винятки вузькі: файл дозволяє лише вказаний тип літерала.
const allowed = {
  'contracts/currencies.ts': ['currencies'], // Джерело валют для незалежних збірок.
  'apps/bff/src/common/currencies.ts': ['currencies'], // Копія, перевірена sync-contracts.
  'apps/ledger-service/src/common/currencies.ts': ['currencies'], // Копія, перевірена sync-contracts.
  'apps/payments-service/src/common/currencies.ts': ['currencies'], // Копія, перевірена sync-contracts.
  'apps/notifications-service/src/common/currencies.ts': ['currencies'], // Копія, перевірена sync-contracts.
  'apps/frontend/lib/currencies.ts': ['currencies'], // Копія, перевірена sync-contracts.
  'contracts/is-money-amount.ts': ['amount'], // Джерело публічного ліміту суми.
  'apps/bff/src/common/is-money-amount.ts': ['amount'], // Копія, перевірена sync-contracts.
  'apps/ledger-service/src/wallets/dto/is-money-amount.ts': ['amount'], // Копія, перевірена sync-contracts.
  'apps/payments-service/src/common/is-money-amount.ts': ['amount'], // Копія, перевірена sync-contracts.
  'apps/frontend/lib/validation.ts': ['amount'], // Ліміт форми; тест звіряє з contracts.
  'apps/frontend/lib/server-config.ts': ['loopback'], // Єдині локальні fallback URL фронтенда.
  'apps/bff/src/config/env.validation.ts': ['loopback'], // Явні значення конфігурації за замовчуванням.
  'apps/ledger-service/src/config/env.validation.ts': ['loopback'], // Явні значення конфігурації за замовчуванням.
  'apps/payments-service/src/config/env.validation.ts': ['loopback'], // Явні значення конфігурації за замовчуванням.
  'apps/notifications-service/src/config/env.validation.ts': ['loopback'], // Явні значення конфігурації за замовчуванням.
  'contracts/config-policy.ts': ['placeholder'], // Відхилення плейсхолдерів, а не секрет.
  'apps/bff/src/config/config-policy.ts': ['placeholder'], // Копія правила відхилення, sync-contracts.
  'apps/ledger-service/src/config/config-policy.ts': ['placeholder'], // Копія правила відхилення, sync-contracts.
  'apps/payments-service/src/config/config-policy.ts': ['placeholder'], // Копія правила відхилення, sync-contracts.
  'apps/notifications-service/src/config/config-policy.ts': ['placeholder'], // Копія правила відхилення, sync-contracts.
};

function* sources(path) {
  for (const entry of readdirSync(resolve(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!['test', '__tests__', 'node_modules'].includes(entry.name)) yield* sources(child);
    } else if (/\.(?:[cm]?[jt]sx?|ts\.template)$/.test(entry.name) &&
               !/\.(?:spec|test)\./.test(entry.name)) yield child;
  }
}

let violations = 0;
for (const path of roots.flatMap((path) => path.endsWith('.ts') ? [path] : [...sources(path)])) {
  const source = readFileSync(resolve(root, path), 'utf8');
  for (const [name, pattern] of Object.entries(rules)) {
    if (allowed[path]?.includes(name)) continue;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      console.error(`${relative(root, resolve(root, path))}:${line}: ${name}: ${match[0]}`);
      violations++;
    }
  }
}
if (violations) {
  console.error(`Hardcoded value check failed: ${violations} occurrence(s).`);
  process.exitCode = 1;
} else console.log('Hardcoded value check passed.');
