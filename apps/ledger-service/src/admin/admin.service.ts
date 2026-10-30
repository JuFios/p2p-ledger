import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { upcast } from '../ledger/domain/upcasters';
import { accounts } from '../ledger/domain/postings';
import { ledgerNotFound } from '../ledger/ledger-errors';
import { Wallet } from '../wallets/entities/wallet.entity';
import { reconcile, ReconciliationRange } from './reconciliation';

interface EventRow {
  globalPosition: string;
  eventId: string;
  streamId: string;
  streamVersion: number;
  type: string;
  schemaVersion: number;
  payload: unknown;
  metadata: unknown;
  recordedAt: Date;
}

@Injectable()
export class AdminService {
  constructor(private readonly dataSource: DataSource) {}

  // Event-лог гаманця хронологічно: власний потік гаманця плюс події, чиї
  // проводки зачіпають його рахунки (так отримувач бачить TransferCompleted).
  // Payload — у поточній версії схеми (через upcaster'и).
  async walletEvents(walletId: string) {
    const exists = await this.dataSource.manager.exists(Wallet, {
      where: { id: walletId },
    });
    if (!exists) {
      throw ledgerNotFound('Гаманець не знайдено');
    }
    const rows: EventRow[] = await this.dataSource.query(
      `SELECT global_position::text AS "globalPosition", event_id AS "eventId",
         stream_id AS "streamId", stream_version AS "streamVersion",
         event_type AS type, schema_version AS "schemaVersion",
         payload, metadata, recorded_at AS "recordedAt"
       FROM events
       WHERE stream_id = $1
          OR event_id IN (SELECT event_id FROM postings WHERE account IN ($2, $3))
       ORDER BY global_position`,
      [walletId, accounts.available(walletId), accounts.held(walletId)],
    );
    return rows.map((row) => ({ ...row, ...upcast(row) }));
  }

  reconcile(range: ReconciliationRange) {
    return reconcile(this.dataSource, range);
  }
}
