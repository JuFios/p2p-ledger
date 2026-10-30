import { Check, Column, Entity, Index, PrimaryColumn } from 'typeorm';

export type HoldStatus = 'ACTIVE' | 'RELEASED' | 'CAPTURED';

// Проєкція холдів під перекази (hold_id = transferId).
@Entity('holds')
@Index(['walletId', 'status'])
@Check(`"status" IN ('ACTIVE', 'RELEASED', 'CAPTURED')`)
@Check(`"amount_minor" > 0`)
export class Hold {
  @PrimaryColumn({ name: 'hold_id', type: 'uuid' })
  holdId: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @Column({ name: 'amount_minor', type: 'bigint' })
  amountMinor: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ type: 'varchar', length: 8 })
  status: HoldStatus;

  @Column({ name: 'transfer_id', type: 'uuid' })
  transferId: string;
}
