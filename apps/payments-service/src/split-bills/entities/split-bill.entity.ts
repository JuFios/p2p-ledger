import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SplitShare } from './split-share.entity';

export const SPLIT_MODES = ['EQUAL', 'CUSTOM'] as const;
export type SplitMode = (typeof SPLIT_MODES)[number];

// Груповий рахунок. Статус рахунку не зберігається: він завжди виводиться
// з часток (aggregateBillStatus), тож розійтись з ними не може.
@Entity('split_bills')
@Index(['creatorUserId', 'createdAt'])
// Створення рахунку з Idempotency-Key; без ключа (NULL) рахунки незалежні.
@Index(['creatorUserId', 'idempotencyKey'], { unique: true })
// Воркер прострочених часток шукає лише рахунки з терміном.
@Index(['dueAt'], { where: '"due_at" IS NOT NULL' })
@Check(`"total_minor" > 0`)
@Check(`"mode" IN ('EQUAL', 'CUSTOM')`)
export class SplitBill {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'creator_user_id', type: 'uuid' })
  creatorUserId: string;

  @Column({ name: 'creator_email', type: 'varchar' })
  creatorEmail: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128, nullable: true })
  idempotencyKey: string | null;

  @Column({ name: 'request_hash', type: 'varchar', length: 64, nullable: true })
  requestHash: string | null;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ name: 'total_minor', type: 'bigint' })
  totalMinor: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 6 })
  mode: SplitMode;

  // Термін оплати; без нього частки не прострочуються.
  @Column({ name: 'due_at', type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @OneToMany(() => SplitShare, (share) => share.bill)
  shares: SplitShare[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
