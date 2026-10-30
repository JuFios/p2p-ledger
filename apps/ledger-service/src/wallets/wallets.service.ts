import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { WalletBalance } from './entities/wallet-balance.entity';
import { EventStore } from '../ledger/event-store';
import { formatMinor, toMinor } from '../ledger/domain/money';
import {
  applyPostings,
  depositPostings,
  Posting,
  WalletBalanceState,
  withdrawPostings,
} from '../ledger/domain/postings';
import { Operation } from '../ledger/entities/operation.entity';
import { OutboxMessage } from '../ledger/entities/outbox-message.entity';

// Контракт відповіді стартера (balance рядком) + available/held/frozen.
// balance = available + held: утримані під переказ гроші ще належать власнику.
export interface WalletView {
  id: string;
  ownerId: string;
  currency: string;
  balance: string;
  available: string;
  held: string;
  frozen: boolean;
}

interface LockedWallet {
  wallet: Wallet;
  balance: WalletBalanceState;
}

function toView(wallet: Wallet, balance: WalletBalanceState): WalletView {
  return {
    id: wallet.id,
    ownerId: wallet.ownerId,
    currency: wallet.currency,
    balance: formatMinor(balance.available + balance.held),
    available: formatMinor(balance.available),
    held: formatMinor(balance.held),
    frozen: wallet.frozen,
  };
}

function toState(balance: WalletBalance): WalletBalanceState {
  return { available: BigInt(balance.available), held: BigInt(balance.held) };
}

function hashRequest(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly dataSource: DataSource,
    private readonly eventStore: EventStore,
  ) {}

  // UNIQUE(owner_id, currency) + ON CONFLICT DO NOTHING: паралельні виклики
  // чекають на коміт першого, лише він пише WalletOpened.
  async getOrCreateForUser(
    userId: string,
    currency = 'USD',
  ): Promise<WalletView> {
    return this.dataSource.transaction(async (manager) => {
      const id = randomUUID();
      const inserted: { id: string }[] = await manager.query(
        `INSERT INTO wallets (id, owner_id, currency) VALUES ($1, $2, $3)
         ON CONFLICT (owner_id, currency) DO NOTHING RETURNING id`,
        [id, userId, currency],
      );
      if (inserted.length > 0) {
        const operationId = `open-wallet:${userId}:${currency}`;
        const [event] = await this.eventStore.append(manager, id, 0, [
          {
            type: 'WalletOpened',
            payload: { walletId: id, ownerId: userId, currency },
            metadata: { operationId, actorUserId: userId },
          },
        ]);
        await manager.insert(WalletBalance, {
          walletId: id,
          lastPosition: event.globalPosition,
        });
        await manager.insert(Operation, {
          operationId,
          type: 'open-wallet',
          requestHash: hashRequest({ userId, currency }),
          result: { walletId: id },
        });
      }
      const wallet = await manager.findOneOrFail(Wallet, {
        where: { ownerId: userId, currency },
        relations: { balance: true },
      });
      return toView(wallet, toState(wallet.balance));
    });
  }

  async listForUser(userId: string): Promise<WalletView[]> {
    const wallets = await this.wallets.find({
      where: { ownerId: userId },
      relations: { balance: true },
      order: { createdAt: 'ASC' },
    });
    return wallets.map((w) => toView(w, toState(w.balance)));
  }

  // Єдине місце правила власника. Чужий гаманець віддаємо як неіснуючий,
  // щоб не розкривати його наявність.
  private async findOwned(
    manager: EntityManager,
    userId: string,
    walletId: string,
  ): Promise<Wallet> {
    const wallet = await manager.findOne(Wallet, {
      where: { id: walletId, ownerId: userId },
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    return wallet;
  }

  async getById(userId: string, walletId: string): Promise<WalletView> {
    const wallet = await this.findOwned(this.wallets.manager, userId, walletId);
    const balance = await this.wallets.manager.findOneOrFail(WalletBalance, {
      where: { walletId },
    });
    return toView(wallet, toState(balance));
  }

  // Блокування рядка проєкції до кінця транзакції: усі записи по гаманцю
  // виконуються по черзі, баланс читається вже після попереднього коміту.
  private async lockOwned(
    manager: EntityManager,
    userId: string,
    walletId: string,
  ): Promise<LockedWallet> {
    const wallet = await this.findOwned(manager, userId, walletId);
    const balance = await manager.findOneOrFail(WalletBalance, {
      where: { walletId },
      lock: { mode: 'pessimistic_write' },
    });
    return { wallet, balance: toState(balance) };
  }

  async deposit(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<WalletView> {
    const amountMinor = toMinor(amount);
    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lockOwned(manager, userId, walletId);
      const { id, currency } = locked.wallet;
      return this.record(manager, userId, locked, {
        type: 'MoneyDeposited',
        operation: 'deposit',
        amountMinor,
        postings: depositPostings(id, currency, amountMinor),
      });
    });
  }

  async withdraw(
    userId: string,
    walletId: string,
    amount: number,
  ): Promise<WalletView> {
    const amountMinor = toMinor(amount);
    return this.dataSource.transaction(async (manager) => {
      const locked = await this.lockOwned(manager, userId, walletId);
      if (locked.balance.available < amountMinor) {
        throw new BadRequestException('Недостатньо коштів');
      }
      const { id, currency } = locked.wallet;
      return this.record(manager, userId, locked, {
        type: 'MoneyWithdrawn',
        operation: 'withdraw',
        amountMinor,
        postings: withdrawPostings(id, currency, amountMinor),
      });
    });
  }

  // Одна транзакція: подія з проводками в event store, проєкція балансу,
  // інтеграційна подія в outbox і запис операції.
  private async record(
    manager: EntityManager,
    userId: string,
    { wallet, balance }: LockedWallet,
    command: {
      type: 'MoneyDeposited' | 'MoneyWithdrawn';
      operation: string;
      amountMinor: bigint;
      postings: Posting[];
    },
  ): Promise<WalletView> {
    const after = applyPostings({ [wallet.id]: balance }, command.postings)[
      wallet.id
    ];
    const operationId = `${command.operation}:${userId}:${randomUUID()}`;
    const version = await this.eventStore.streamVersion(manager, wallet.id);
    const [event] = await this.eventStore.append(manager, wallet.id, version, [
      {
        type: command.type,
        payload: {
          walletId: wallet.id,
          currency: wallet.currency,
          amountMinor: command.amountMinor.toString(),
          postings: command.postings,
        },
        metadata: { operationId, actorUserId: userId },
      },
    ]);
    await manager.update(
      WalletBalance,
      { walletId: wallet.id },
      {
        available: after.available.toString(),
        held: after.held.toString(),
        lastPosition: event.globalPosition,
      },
    );
    await manager.insert(OutboxMessage, {
      eventId: event.eventId,
      type: command.type,
      version: 1,
      payload: {
        walletId: wallet.id,
        ownerId: wallet.ownerId,
        currency: wallet.currency,
        amount: formatMinor(command.amountMinor),
        balanceAfter: {
          available: formatMinor(after.available),
          held: formatMinor(after.held),
        },
      },
      userIds: [wallet.ownerId],
      traceparent: null,
    });
    const view = toView(wallet, after);
    await manager.insert(Operation, {
      operationId,
      type: command.operation,
      requestHash: hashRequest({
        walletId: wallet.id,
        amountMinor: command.amountMinor.toString(),
      }),
      result: view,
    });
    return view;
  }
}
