import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { EventMetadata } from '../domain/events';

// Append-only: UPDATE/DELETE заборонені тригером (див. міграцію).
@Entity('events')
@Unique('UQ_events_stream_version', ['streamId', 'streamVersion'])
export class StoredEvent {
  @PrimaryGeneratedColumn('increment', {
    name: 'global_position',
    type: 'bigint',
  })
  globalPosition: string;

  @Column({ name: 'event_id', type: 'uuid', unique: true })
  eventId: string;

  @Column({ name: 'stream_id' })
  streamId: string;

  @Column({ name: 'stream_version', type: 'int' })
  streamVersion: number;

  @Column({ name: 'event_type' })
  eventType: string;

  @Column({ name: 'schema_version', type: 'smallint' })
  schemaVersion: number;

  @Column({ type: 'jsonb' })
  payload: object;

  @Column({ type: 'jsonb' })
  metadata: EventMetadata;

  @Index()
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
