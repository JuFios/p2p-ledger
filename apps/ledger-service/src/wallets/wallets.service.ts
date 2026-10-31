import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
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
import {
  commitChange,
  currentTraceparent,
  findCompletedOperation,
  formatBalance,
  hashRequest,
  lockBalances,
  toState,
} from '../ledger/ledger-writer';
import {
  ledgerConflict,
  ledgerNotFound,
  rethrowOperationConflict,
} from '../ledger/ledger-errors';

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

// Для внутрішнього API (payments): без перевірки власника.
export interface InternalWalletView {
  walletId: string;
  ownerId: string;
  currency: string;
  frozen: boolean;
  available: string;
  held: string;
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

  async getInternal(walletId: string): Promise<InternalWalletView> {
    const wallet = await this.wallets.findOne({
      where: { id: walletId },
      relations: { balance: true },
    });
    if (!wallet) {
      throw ledgerNotFound('Гаманець не знайдено');
    }
    return {
      walletId: wallet.id,
      ownerId: wallet.ownerId,
      currency: wallet.currency,
      frozen: wallet.frozen,
      ...formatBalance(toState(wallet.balance)),
    };
  }

  // Заморожений гаманець не приймає й не віддає гроші (крім зняття холду
  // під час компенсації саги). Розморожування не передбачено.
  async freeze(adminId: string, walletId: string): Promise<WalletView> {
    return this.dataSource.transaction(async (manager) => {
      const { [walletId]: state } = await lockBalances(manager, [walletId]);
      if (!state) {
        throw ledgerNotFound('Гаманець не знайдено');
      }
      const wallet = await manager.findOneOrFail(Wallet, {
        where: { id: walletId },
      });
      if (wallet.frozen) {
        return toView(wallet, state);
      }
      await manager.update(Wallet, { id: walletId }, { frozen: true });
      const view = toView({ ...wallet, frozen: true }, state);
      await commitChange(manager, this.eventStore, {
        streamId: walletId,
        events: [
          {
            type: 'WalletFrozen',
            payload: { walletId },
            metadata: {
              operationId: `freeze:${walletId}`,
              actorUserId: adminId,
              traceparent: currentTraceparent(),
            },
          },
        ],
        balances: { [walletId]: state },
        operation: {
          operationId: `freeze:${walletId}`,
          type: 'freeze',
          request: { walletId },
          result: view,
        },
      });
      return view;
    });
  }

  // Блокування рядка проєкції до кінця транзакції: усі записи по гаманцю
  // виконуються по черзі, баланс читається вже після попереднього коміту.
  private async lockOwned(
    manager: EntityManager,
    userId: string,
    walletId: string,
  ): Promise<LockedWallet> {
    // Чужий гаманець → 404 ще до блокування.
    await this.findOwned(manager, userId, walletId);
    const { [walletId]: balance } = await lockBalances(manager, [walletId]);
    // frozen змінюється лише під цим самим блокуванням (freeze),
    // тому гаманець перечитуємо вже після нього.
    const wallet = await this.findOwned(manager, userId, walletId);
    return { wallet, balance };
  }

  // Idempotency-Key опційний (контракт стартера): без нього кожен запит —
  // нова операція.
  async deposit(
    userId: string,
    walletId: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<WalletView> {
    const amountMinor = toMinor(amount);
    return this.dataSource
      .transaction(async (manager) => {
        const locked = await this.lockOwned(manager, userId, walletId);
        const { id, currency } = locked.wallet;
        return this.record(manager, userId, locked, idempotencyKey, {
          type: 'MoneyDeposited',
          operation: 'deposit',
          amountMinor,
          postings: depositPostings(id, currency, amountMinor),
        });
      })
      .catch(rethrowOperationConflict);
  }

  async withdraw(
    userId: string,
    walletId: string,
    amount: number,
    idempotencyKey?: string,
  ): Promise<WalletView> {
    const amountMinor = toMinor(amount);
    return this.dataSource
      .transaction(async (manager) => {
        const locked = await this.lockOwned(manager, userId, walletId);
        const { id, currency } = locked.wallet;
        return this.record(manager, userId, locked, idempotencyKey, {
          type: 'MoneyWithdrawn',
          operation: 'withdraw',
          amountMinor,
          postings: withdrawPostings(id, currency, amountMinor),
        });
      })
      .catch(rethrowOperationConflict);
  }

  // Одна транзакція: подія з проводками в event store, проєкція балансу,
  // інтеграційна подія в outbox і запис операції.
  private async record(
    manager: EntityManager,
    userId: string,
    { wallet, balance }: LockedWallet,
    idempotencyKey: string | undefined,
    command: {
      type: 'MoneyDeposited' | 'MoneyWithdrawn';
      operation: string;
      amountMinor: bigint;
      postings: Posting[];
    },
  ): Promise<WalletView> {
    const request = {
      walletId: wallet.id,
      amountMinor: command.amountMinor.toString(),
    };
    const operationId = `${command.operation}:${userId}:${idempotencyKey ?? randomUUID()}`;
    if (idempotencyKey) {
      const done = await findCompletedOperation<WalletView>(
        manager,
        operationId,
        request,
      );
      if (done) return done;
    }
    if (wallet.frozen) {
      throw ledgerConflict('WALLET_FROZEN', 'Гаманець заморожено');
    }
    if (
      command.type === 'MoneyWithdrawn' &&
      balance.available < command.amountMinor
    ) {
      throw new BadRequestException('Недостатньо коштів');
    }
    const after = applyPostings({ [wallet.id]: balance }, command.postings)[
      wallet.id
    ];
    const view = toView(wallet, after);
    await commitChange(manager, this.eventStore, {
      streamId: wallet.id,
      events: [
        {
          type: command.type,
          payload: {
            walletId: wallet.id,
            currency: wallet.currency,
            amountMinor: command.amountMinor.toString(),
            postings: command.postings,
          },
          metadata: {
            operationId,
            actorUserId: userId,
            traceparent: currentTraceparent(),
          },
          publish: {
            payload: {
              walletId: wallet.id,
              ownerId: wallet.ownerId,
              currency: wallet.currency,
              amount: formatMinor(command.amountMinor),
              balanceAfter: formatBalance(after),
            },
            userIds: [wallet.ownerId],
          },
        },
      ],
      balances: { [wallet.id]: after },
      operation: { operationId, type: command.operation, request, result: view },
    });
    return view;
  }
}
