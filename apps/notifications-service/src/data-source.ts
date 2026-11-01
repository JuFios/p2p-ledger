import { PushUpdatePosition } from './events/push-update-position.entity';
import { StablePushPositions1793541600000 } from './migrations/1793541600000-StablePushPositions';
import { WalletUpdatePositions1793538000000 } from './migrations/1793538000000-WalletUpdatePositions';
import { DataSource } from 'typeorm';
import { Activity, ProcessedEvent } from './activity/activity.entity';
import { InitialSchema1793534400000 } from './migrations/1793534400000-InitialSchema';

export const entities = [Activity, ProcessedEvent, PushUpdatePosition];
export const migrations = [InitialSchema1793534400000, WalletUpdatePositions1793538000000, StablePushPositions1793541600000];

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
