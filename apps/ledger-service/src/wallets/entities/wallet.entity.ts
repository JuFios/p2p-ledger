import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { WalletBalance } from './wallet-balance.entity';

// Реєстр гаманців. Баланс — не поле, а проєкція подій (WalletBalance).
// Зв'язку з User немає: власник — лише ownerId (межа між auth і ledger).
@Entity('wallets')
@Unique(['ownerId', 'currency'])
export class Wallet {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'char', length: 3 })
  currency: string;

  @Column({ default: false })
  frozen: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToOne(() => WalletBalance, (balance) => balance.wallet)
  balance: WalletBalance;
}
