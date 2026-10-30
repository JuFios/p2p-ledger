import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly dataSource: DataSource,
  ) {}

  async getOrCreateForUser(userId: string, currency = 'USD'): Promise<Wallet> {
    let wallet = await this.wallets.findOne({ where: { ownerId: userId, currency } });
    if (!wallet) {
      wallet = await this.wallets.save(
        this.wallets.create({ ownerId: userId, currency, balance: '0' }),
      );
    }
    return wallet;
  }

  async listForUser(userId: string): Promise<Wallet[]> {
    return this.wallets.find({ where: { ownerId: userId } });
  }

  // Чужий гаманець віддаємо як неіснуючий, щоб не розкривати його наявність.
  async getById(userId: string, walletId: string): Promise<Wallet> {
    const wallet = await this.wallets.findOne({
      where: { id: walletId, ownerId: userId },
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    return wallet;
  }

  // Блокуємо рядок гаманця до кінця транзакції: паралельні запити
  // виконуються по черзі, а арифметика йде в SQL над numeric, не через Number.
  private async lockOwned(
    manager: EntityManager,
    userId: string,
    walletId: string,
  ): Promise<void> {
    const wallet = await manager.findOne(Wallet, {
      where: { id: walletId, ownerId: userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
  }

  async deposit(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<Wallet> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockOwned(manager, userId, walletId);
      await manager.query(
        'UPDATE wallets SET balance = balance + $1::numeric WHERE id = $2',
        [amount.toFixed(2), walletId],
      );
      return manager.findOneOrFail(Wallet, { where: { id: walletId } });
    });
  }

  async withdraw(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<Wallet> {
    return this.dataSource.transaction(async (manager) => {
      await this.lockOwned(manager, userId, walletId);
      const [{ sufficient }] = await manager.query(
        'SELECT balance >= $1::numeric AS sufficient FROM wallets WHERE id = $2',
        [amount.toFixed(2), walletId],
      );
      if (!sufficient) {
        throw new BadRequestException('Недостатньо коштів');
      }
      await manager.query(
        'UPDATE wallets SET balance = balance - $1::numeric WHERE id = $2',
        [amount.toFixed(2), walletId],
      );
      return manager.findOneOrFail(Wallet, { where: { id: walletId } });
    });
  }
}
