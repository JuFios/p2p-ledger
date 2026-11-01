import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('wallet_update_positions')
export class WalletUpdatePosition {
  @PrimaryColumn({ name: 'wallet_id', type: 'uuid' }) walletId: string;
  @Column({ type: 'numeric', precision: 20, scale: 0 }) milliseconds: string;
  @Column({ type: 'numeric', precision: 20, scale: 0 }) sequence: string;
}
