import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Direction } from '../domain/postings';

// Журнал проводок (double-entry). recorded_at = час транзакції, тож усі
// проводки однієї операції потрапляють в один період звірки.
@Entity('postings')
@Check(`"direction" IN ('DEBIT', 'CREDIT')`)
@Check(`"amount_minor" > 0`)
export class PostingEntry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ name: 'event_id', type: 'uuid' })
  eventId: string;

  @Index()
  @Column({ name: 'operation_id' })
  operationId: string;

  @Index()
  @Column()
  account: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 6 })
  direction: Direction;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Index()
  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt: Date;
}
