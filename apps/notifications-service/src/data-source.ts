import { DataSource } from 'typeorm';
import { readDatabaseEnvironment } from './config/runtime-env';
import { Activity, ProcessedEvent } from './activity/activity.entity';
import { PushUpdatePosition } from './events/push-update-position.entity';
import { InitialSchema1793534400000 } from './migrations/1793534400000-InitialSchema';

export const entities = [Activity, ProcessedEvent, PushUpdatePosition];
export const migrations = [InitialSchema1793534400000];

export default new DataSource({
  type: 'postgres',
  ...readDatabaseEnvironment(),
  entities,
  migrations,
});
