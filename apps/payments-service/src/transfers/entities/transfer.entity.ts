import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export const TRANSFER_STATUSES = [
  'PENDING',
  'PROCESSING',
  'AWAITING_RETRY',
  'COMPENSATING',
  'COMPLETED',
  'FAILED',
] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const TRANSFER_STEPS = [
  'RISK_CHECK',
  'RESOLVE_RECIPIENT',
  'FX_QUOTE',
  'HOLD',
  'CONFIRM',
  'CAPTURE',
  'RELEASE_HOLD',
  'DONE',
] as const;
export type TransferStep = (typeof TRANSFER_STEPS)[number];

const quoted = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(', ');

// Переказ = стан саги. Холд у ledger має той самий id, що й переказ.
@Entity('transfers')
@Index(['senderUserId', 'idempotencyKey'], { unique: true })
@Index(['status', 'nextAttemptAt'])
@Index(['senderUserId', 'createdAt'])
@Index(['recipientUserId'])
@Index(['splitShareId'])
@Check(`"amount_minor" > 0`)
@Check(`"status" IN (${quoted(TRANSFER_STATUSES)})`)
@Check(`"step" IN (${quoted(TRANSFER_STEPS)})`)
export class Transfer {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'sender_user_id', type: 'uuid' })
  senderUserId: string;

  @Column({ name: 'sender_email', type: 'varchar' })
  senderEmail: string;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash: string;

  @Column({ name: 'from_wallet_id', type: 'uuid' })
  fromWalletId: string;

  @Column({ name: 'recipient_email', type: 'varchar' })
  recipientEmail: string;

  @Column({ name: 'recipient_user_id', type: 'uuid', nullable: true })
  recipientUserId: string | null;

  @Column({ name: 'to_wallet_id', type: 'uuid', nullable: true })
  toWalletId: string | null;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ name: 'to_amount_minor', type: 'bigint', nullable: true })
  toAmountMinor: string | null;

  @Column({ name: 'to_currency', type: 'char', length: 3 })
  toCurrency: string;

  @Column({
    name: 'fx_rate',
    type: 'numeric',
    precision: 18,
    scale: 8,
    nullable: true,
  })
  fxRate: string | null;

  @Column({ name: 'fx_quoted_at', type: 'timestamptz', nullable: true })
  fxQuotedAt: Date | null;

  @Column({ type: 'varchar', length: 16 })
  status: TransferStatus;

  @Column({ type: 'varchar', length: 20 })
  step: TransferStep;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'next_attempt_at', type: 'timestamptz' })
  nextAttemptAt: Date;

  // Lease кроку саги: поки не минув, переказ не підхоплює інший runner.
  @Column({ name: 'locked_until', type: 'timestamptz', nullable: true })
  lockedUntil: Date | null;

  @Column({ name: 'failure_reason', type: 'varchar', nullable: true })
  failureReason: string | null;

  @Column({ name: 'split_share_id', type: 'uuid', nullable: true })
  splitShareId: string | null;

  @Column({ type: 'varchar', nullable: true })
  traceparent: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
