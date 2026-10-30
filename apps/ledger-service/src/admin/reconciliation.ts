import { DataSource } from 'typeorm';
import { DomainEvent } from '../ledger/domain/events';
import { formatMinor } from '../ledger/domain/money';
import { Balances } from '../ledger/domain/postings';
import { projectBalances } from '../ledger/domain/projection';
import { formatBalance, toState } from '../ledger/ledger-writer';
import { WalletBalance } from '../wallets/entities/wallet-balance.entity';

export interface ReconciliationRange {
  from?: Date;
  to?: Date;
}

export interface ProjectionMismatch {
  walletId: string;
  // null — гаманця немає з цього боку.
  rebuilt: { available: string; held: string } | null;
  projection: { available: string; held: string } | null;
}

export interface ReconciliationReport {
  from: string | null;
  to: string | null;
  perCurrency: {
    currency: string;
    debits: string;
    credits: string;
    diff: string;
  }[];
  projectionMismatches: ProjectionMismatch[];
  ok: boolean;
}

const BATCH = 1000;

export function compareBalances(
  rebuilt: Balances,
  projection: Balances,
): ProjectionMismatch[] {
  const ids = [
    ...new Set([...Object.keys(rebuilt), ...Object.keys(projection)]),
  ].sort();
  return ids
    .filter(
      (id) =>
        rebuilt[id]?.available !== projection[id]?.available ||
        rebuilt[id]?.held !== projection[id]?.held,
    )
    .map((id) => ({
      walletId: id,
      rebuilt: rebuilt[id] ? formatBalance(rebuilt[id]) : null,
      projection: projection[id] ? formatBalance(projection[id]) : null,
    }));
}

// (1) Глобальний інваріант подвійного запису: Σ DEBIT = Σ CREDIT за період
// по кожній валюті. (2) Повна перебудова балансів з event-логу (з upcaster'ами)
// і порівняння з матеріалізованою проєкцією. Проєкцію не перезаписує.
// REPEATABLE READ — один знімок БД: паралельні операції не дають хибних розбіжностей.
export async function reconcile(
  dataSource: DataSource,
  range: ReconciliationRange,
): Promise<ReconciliationReport> {
  return dataSource.transaction('REPEATABLE READ', async (manager) => {
    await manager.query('SET TRANSACTION READ ONLY');
    const totals: { currency: string; debits: string; credits: string }[] =
      await manager.query(
        `SELECT currency,
           COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'DEBIT'), 0)::text AS debits,
           COALESCE(SUM(amount_minor) FILTER (WHERE direction = 'CREDIT'), 0)::text AS credits
         FROM postings
         WHERE ($1::timestamptz IS NULL OR recorded_at >= $1)
           AND ($2::timestamptz IS NULL OR recorded_at < $2)
         GROUP BY currency ORDER BY currency`,
        [range.from ?? null, range.to ?? null],
      );
    const perCurrency = totals.map((t) => {
      const diff = BigInt(t.debits) - BigInt(t.credits);
      return {
        currency: t.currency.trim(),
        debits: formatMinor(BigInt(t.debits)),
        credits: formatMinor(BigInt(t.credits)),
        diff: formatMinor(diff),
      };
    });

    let rebuilt: Balances = {};
    let after = '0';
    for (;;) {
      const rows: {
        position: string;
        type: string;
        schemaVersion: number;
        payload: unknown;
      }[] = await manager.query(
        `SELECT global_position::text AS position, event_type AS type,
           schema_version AS "schemaVersion", payload
         FROM events WHERE global_position > $1
         ORDER BY global_position LIMIT ${BATCH}`,
        [after],
      );
      if (rows.length === 0) break;
      rebuilt = projectBalances(rows as DomainEvent<unknown>[], rebuilt);
      after = rows[rows.length - 1].position;
    }

    const projection: Balances = Object.fromEntries(
      (await manager.find(WalletBalance)).map((b) => [b.walletId, toState(b)]),
    );
    const projectionMismatches = compareBalances(rebuilt, projection);

    return {
      from: range.from?.toISOString() ?? null,
      to: range.to?.toISOString() ?? null,
      perCurrency,
      projectionMismatches,
      ok:
        perCurrency.every((c) => c.diff === '0.00') &&
        projectionMismatches.length === 0,
    };
  });
}
