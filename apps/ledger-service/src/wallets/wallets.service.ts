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

  // UNIQUE(ownerId, currency) + ON CONFLICT DO NOTHING: паралельні виклики
  // не створюють дублікатів і всі отримують один і той самий гаманець.
  async getOrCreateForUser(userId: string, currency = 'USD'): Promise<Wallet> {
    await this.wallets
      .createQueryBuilder()
      .insert()
      .values({ ownerId: userId, currency, balance: '0' })
      .orIgnore()
      .execute();
    return this.wallets.findOneOrFail({
      where: { ownerId: userId, currency },
    });
  }

  async listForUser(userId: string): Promise<Wallet[]> {
    return this.wallets.find({ where: { ownerId: userId } });
  }

  // Єдине місце правила власника. Чужий гаманець віддаємо як неіснуючий,
  // щоб не розкривати його наявність. Із lock блокуємо рядок до кінця
  // транзакції: паралельні запити виконуються по черзі.
  private async findOwned(
    userId: string,
    walletId: string,
    manager: EntityManager = this.wallets.manager,
    lock = false,
  ): Promise<Wallet> {
    const wallet = await manager.findOne(Wallet, {
      where: { id: walletId, ownerId: userId },
      ...(lock && { lock: { mode: 'pessimistic_write' as const } }),
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    return wallet;
  }

  getById(userId: string, walletId: string): Promise<Wallet> {
    return this.findOwned(userId, walletId);
  }

  // Арифметика йде в SQL над numeric, не через Number.
  async deposit(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<Wallet> {
    return this.dataSource.transaction(async (manager) => {
      await this.findOwned(userId, walletId, manager, true);
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
      await this.findOwned(userId, walletId, manager, true);
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
