import { DataSource } from 'typeorm';
import { Transfer } from './transfers/entities/transfer.entity';
import { SplitBill } from './split-bills/entities/split-bill.entity';
import { SplitShare } from './split-bills/entities/split-share.entity';
import { OutboxMessage } from './outbox/outbox-message.entity';
import { InitialSchema1793450132562 } from './migrations/1793450132562-InitialSchema';
import { AddSplitBills1793452552930 } from './migrations/1793452552930-AddSplitBills';
import { SplitBillIdempotency1793456057896 } from './migrations/1793456057896-SplitBillIdempotency';

export const entities = [Transfer, OutboxMessage, SplitBill, SplitShare];

export const migrations = [
  InitialSchema1793450132562,
  AddSplitBills1793452552930,
  SplitBillIdempotency1793456057896,
];

// Для TypeORM CLI (migration:generate / migration:run). Застосунок підключається
// через TypeOrmModule.forRootAsync з тими самими entities і migrations.
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
