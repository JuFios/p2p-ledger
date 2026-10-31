import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from './wallet.entity';

// Проєкція балансу (read model) у мінорних одиницях. Оновлюється в тій самій
// транзакції, що й подія; CHECK — останній рубіж проти овердрафту.
@Entity('wallet_balances')
@Check(`"available" >= 0`)
@Check(`"held" >= 0`)
export class WalletBalance {
  @PrimaryColumn({ name: 'wallet_id', type: 'uuid' })
  walletId: string;

  @OneToOne(() => Wallet, (wallet) => wallet.balance)
  @JoinColumn({ name: 'wallet_id' })
  wallet: Wallet;

  @Column({ type: 'bigint', default: 0 })
  available: string;

  @Column({ type: 'bigint', default: 0 })
  held: string;

  // Позиція останньої застосованої події в event store.
  @Column({ name: 'last_position', type: 'bigint', default: 0 })
  lastPosition: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
