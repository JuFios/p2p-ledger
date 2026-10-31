import { DataSource } from 'typeorm';
import { Transfer } from './transfers/entities/transfer.entity';
import { OutboxMessage } from './outbox/outbox-message.entity';
import { InitialSchema1793450132562 } from './migrations/1793450132562-InitialSchema';

export const entities = [Transfer, OutboxMessage];

export const migrations = [InitialSchema1793450132562];

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
