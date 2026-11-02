import { DataSource } from 'typeorm';
import { User } from './auth/entities/user.entity';
import { Wallet } from './wallets/entities/wallet.entity';
import { WalletBalance } from './wallets/entities/wallet-balance.entity';
import { StoredEvent } from './ledger/entities/stored-event.entity';
import { PostingEntry } from './ledger/entities/posting.entity';
import { Operation } from './ledger/entities/operation.entity';
import { Hold } from './ledger/entities/hold.entity';
import { OutboxMessage } from './ledger/entities/outbox-message.entity';
import { InitialSchema1793370448769 } from './migrations/1793370448769-InitialSchema';
import { AddRefreshSession1793658000000 } from './migrations/1793658000000-AddRefreshSession';

export const entities = [
  User,
  Wallet,
  WalletBalance,
  StoredEvent,
  PostingEntry,
  Operation,
  Hold,
  OutboxMessage,
];

export const migrations = [
  InitialSchema1793370448769,
  AddRefreshSession1793658000000,
];

// Для TypeORM CLI (migration:generate / migration:run). Застосунок підключається
// через TypeOrmModule.forRoot з тими самими entities і migrations.
export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  entities,
  migrations,
});
