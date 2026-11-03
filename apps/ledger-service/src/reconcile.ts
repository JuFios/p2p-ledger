import { isCalendarDate } from './common/is-calendar-date';
import dataSource from './data-source';
import { reconcile } from './admin/reconciliation';

// npm run reconcile [-- --from=<ISO> --to=<ISO>]: те саме, що
// GET /admin/reconciliation, напряму проти БД (env DATABASE_*).
// Код виходу 1, якщо знайдено розбіжності.
function arg(name: string): Date | undefined {
  const raw = process.argv
    .find((a) => a.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (!isCalendarDate(raw)) {
    throw new Error(`Некоректна дата --${name}=${raw}`);
  }
  return date;
}

async function main() {
  const range = { from: arg('from'), to: arg('to') };
  await dataSource.initialize();
  try {
    const report = await reconcile(dataSource, range);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ok ? 0 : 1;
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 2;
});
