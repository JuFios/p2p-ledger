import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  PrimaryColumn,
} from 'typeorm';

export const ACTIVITY_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'TRANSFER_SENT',
  'TRANSFER_RECEIVED',
  'TRANSFER_FAILED',
  'SPLIT_BILL',
  'SPLIT_REMINDER',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

@Entity('activity')
@Index('IDX_activity_user_created', ['userId', 'createdAt'])
@Index('IDX_activity_user_type', ['userId', 'type'])
export class Activity {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column({ name: 'event_id', type: 'uuid' }) eventId: string;
  @Column({ name: 'user_id', type: 'uuid' }) userId: string;
  @Column({ type: 'varchar' }) type: ActivityType;
  @Column({ type: 'jsonb' }) payload: Record<string, unknown>;
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}

@Entity('processed_events')
export class ProcessedEvent {
  @PrimaryColumn({ name: 'event_id', type: 'uuid' }) eventId: string;
}
