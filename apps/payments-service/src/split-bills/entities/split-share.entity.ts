import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SplitBill } from './split-bill.entity';

export const SHARE_STATUSES = ['PENDING', 'ACCEPTED', 'PAYING', 'PAID'] as const;
export type ShareStatus = (typeof SHARE_STATUSES)[number];

// Частка учасника: PENDING → (accept) ACCEPTED → (pay) PAYING → PAID.
// Невдала оплата повертає PAYING → ACCEPTED.
@Entity('split_shares')
@Index(['billId', 'participantUserId'], { unique: true })
@Index(['participantUserId'])
@Check(`"amount_minor" > 0`)
@Check(`"status" IN ('PENDING', 'ACCEPTED', 'PAYING', 'PAID')`)
export class SplitShare {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId: string;

  @ManyToOne(() => SplitBill, (bill) => bill.shares, { nullable: false })
  @JoinColumn({ name: 'bill_id' })
  bill: SplitBill;

  // Порядок учасників у рахунку; перший отримує залишок копійок.
  @Column({ type: 'smallint' })
  position: number;

  @Column({ name: 'participant_user_id', type: 'uuid' })
  participantUserId: string;

  @Column({ name: 'participant_email', type: 'varchar' })
  participantEmail: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column({ type: 'varchar', length: 8, default: 'PENDING' })
  status: ShareStatus;

  // Коли востаннє надсилали нагадування про прострочену частку.
  @Column({ name: 'last_reminded_at', type: 'timestamptz', nullable: true })
  lastRemindedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
