import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

// Transactional outbox: інтеграційні події пишуться в тій самій транзакції,
// що й подія в event store, і публікуються в стрім окремим relay.
@Entity('outbox')
@Index('IDX_outbox_unpublished', ['id'], { where: '"published_at" IS NULL' })
export class OutboxMessage {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'event_id', type: 'uuid', unique: true })
  eventId: string;

  @Column()
  type: string;

  @Column({ type: 'smallint' })
  version: number;

  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @Column({ name: 'user_ids', type: 'uuid', array: true })
  userIds: string[];

  @Column({ type: 'varchar', nullable: true })
  traceparent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
