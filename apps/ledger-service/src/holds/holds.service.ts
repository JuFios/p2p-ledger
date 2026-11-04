import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { EventStore } from '../ledger/event-store';
import { formatMinor } from '../ledger/domain/money';
import {
  applyPostings,
  Balances,
  capturePostings,
  holdPostings,
  releasePostings,
  WalletBalanceState,
} from '../ledger/domain/postings';
import { Hold, HoldStatus } from '../ledger/entities/hold.entity';
import { Operation } from '../ledger/entities/operation.entity';
import {
  commitChange,
  findCompletedOperation,
  formatBalance,
  lockBalances,
} from '../ledger/ledger-writer';
import { hashRequest } from '../common/request-hash';
import { currentTraceparent } from '../common/tracing';
import {
  ledgerConflict,
  ledgerNotFound,
  rethrowOperationConflict,
} from '../ledger/ledger-errors';
import { Wallet } from '../wallets/entities/wallet.entity';

export interface PlaceHoldCommand {
  operationId: string;
  holdId: string;
  walletId: string;
  ownerId: string;
  amountMinor: string;
  currency: string;
  transferId: string;
}

export interface ReleaseHoldCommand {
  operationId: string;
  reason?: string;
  walletId?: string;
}

export interface CaptureHoldCommand {
  operationId: string;
  toWalletId: string;
  toAmountMinor: string;
  toCurrency: string;
  fxRate: number;
}

export interface HoldView {
  holdId: string;
  status: HoldStatus;
}

// Слід зняття холду, якого ще не було (release раніше за запізнілий place).
// Живе в `operations`: окремої таблиці й міграції не потрібно.
const releasedBeforePlaced = (holdId: string) => `hold-released:${holdId}`;

// Знімок гаманця для інтеграційних подій (сума й баланс — рядками "0.00").
function walletPayload(
  wallet: Wallet,
  amountMinor: bigint,
  balance: WalletBalanceState,
) {
  return {
    walletId: wallet.id,
    ownerId: wallet.ownerId,
    currency: wallet.currency,
    amount: formatMinor(amountMinor),
    balanceAfter: formatBalance(balance),
  };
}

// Холди під перекази: кошти переходять з available у held і далі або
// повертаються (release), або списуються на користь отримувача (capture).
// Події переказу пишуться в потік гаманця відправника.
@Injectable()
export class HoldsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly eventStore: EventStore,
  ) {}

  async get(holdId: string): Promise<HoldView> {
    const hold = await this.dataSource.manager.findOne(Hold, {
      where: { holdId },
    });
    if (!hold) {
      throw ledgerNotFound('Холд не знайдено');
    }
    return { holdId: hold.holdId, status: hold.status };
  }

  async place(command: PlaceHoldCommand): Promise<HoldView> {
    const amountMinor = BigInt(command.amountMinor);
    return this.dataSource
      .transaction(async (manager) => {
        const balances = await lockBalances(manager, [command.walletId]);
        const done = await findCompletedOperation<HoldView>(
          manager,
          command.operationId,
          command,
        );
        if (done) return done;
        if (
          await manager.findOne(Operation, {
            where: { operationId: releasedBeforePlaced(command.holdId) },
          })
        ) {
          throw ledgerConflict('HOLD_NOT_ACTIVE', 'Холд уже знято');
        }

        const wallet = await this.findWallet(manager, command.walletId);
        if (wallet.ownerId !== command.ownerId) {
          throw ledgerConflict('OWNER_MISMATCH', 'Гаманець належить іншому');
        }
        if (wallet.currency !== command.currency) {
          throw ledgerConflict('CURRENCY_MISMATCH', 'Інша валюта гаманця');
        }
        if (wallet.frozen) {
          throw ledgerConflict('WALLET_FROZEN', 'Гаманець заморожено');
        }
        if (balances[wallet.id].available < amountMinor) {
          throw ledgerConflict('INSUFFICIENT_FUNDS', 'Недостатньо коштів');
        }
        if (await manager.findOne(Hold, { where: { holdId: command.holdId } })) {
          // Той самий холд з іншим operationId.
          throw ledgerConflict('HOLD_NOT_ACTIVE', 'Холд уже існує');
        }

        const postings = holdPostings(wallet.id, wallet.currency, amountMinor);
        const after = applyPostings(balances, postings);
        const metadata = {
          operationId: command.operationId,
          transferId: command.transferId,
          traceparent: currentTraceparent(),
        };
        const publish = {
          payload: {
            transferId: command.transferId,
            holdId: command.holdId,
            ...walletPayload(wallet, amountMinor, after[wallet.id]),
          },
          userIds: [wallet.ownerId],
        };
        await manager.insert(Hold, {
          holdId: command.holdId,
          walletId: wallet.id,
          amountMinor: command.amountMinor,
          currency: wallet.currency,
          status: 'ACTIVE',
          transferId: command.transferId,
        });
        const result: HoldView = { holdId: command.holdId, status: 'ACTIVE' };
        await commitChange(manager, this.eventStore, {
          streamId: wallet.id,
          events: [
            {
              type: 'TransferInitiated',
              payload: {
                transferId: command.transferId,
                walletId: wallet.id,
                ownerId: wallet.ownerId,
                currency: wallet.currency,
                amountMinor: command.amountMinor,
              },
              metadata,
              publish,
            },
            {
              type: 'HoldPlaced',
              payload: {
                holdId: command.holdId,
                transferId: command.transferId,
                walletId: wallet.id,
                currency: wallet.currency,
                amountMinor: command.amountMinor,
                postings,
              },
              metadata,
              publish,
            },
          ],
          balances: after,
          operation: {
            operationId: command.operationId,
            type: 'hold',
            request: command,
            result,
          },
        });
        return result;
      })
      .catch(rethrowOperationConflict);
  }

  // Повернення коштів з held в available. З reason — це компенсація саги,
  // тож додатково пишемо TransferFailed. Заморожений гаманець не заважає:
  // компенсація має пройти завжди.
  async release(
    holdId: string,
    command: ReleaseHoldCommand,
  ): Promise<HoldView> {
    const request = { holdId, ...command };
    return this.dataSource
      .transaction((manager) =>
        this.releaseIn(manager, holdId, command, request),
      )
      .catch(rethrowOperationConflict);
  }

  private async releaseIn(
    manager: EntityManager,
    holdId: string,
    command: ReleaseHoldCommand,
    request: unknown,
  ): Promise<HoldView> {
    if (command.walletId) {
      const existing = await manager.findOne(Hold, { where: { holdId } });
      if (!existing) {
        return this.releaseUnplaced(manager, holdId, command, request);
      }
      // Гаманець холду не змінюється, тож перевірка до блокування коректна;
      // без неї слід зняття блокував би не той гаманець, що place.
      if (existing.walletId !== command.walletId) {
        throw new BadRequestException('walletId не збігається з гаманцем холду');
      }
    }
    const { hold: active, balances } = await this.lockHold(
      manager,
      holdId,
      [],
    );
    const done = await findCompletedOperation<HoldView>(
      manager,
      command.operationId,
      request,
    );
    if (done) return done;
    assertActive(active);

    const wallet = await this.findWallet(manager, active.walletId);
    const amountMinor = BigInt(active.amountMinor);
    const postings = releasePostings(
      wallet.id,
      wallet.currency,
      amountMinor,
    );
    const after = applyPostings(balances, postings);
    const metadata = {
      operationId: command.operationId,
      transferId: active.transferId,
      traceparent: currentTraceparent(),
    };
    const snapshot = walletPayload(wallet, amountMinor, after[wallet.id]);
    await manager.update(Hold, { holdId }, { status: 'RELEASED' });
    const result: HoldView = { holdId, status: 'RELEASED' };
    await commitChange(manager, this.eventStore, {
      streamId: wallet.id,
      events: [
        {
          type: 'HoldReleased',
          payload: {
            holdId,
            transferId: active.transferId,
            walletId: wallet.id,
            currency: wallet.currency,
            amountMinor: active.amountMinor,
            postings,
          },
          metadata,
          publish: {
            payload: { transferId: active.transferId, holdId, ...snapshot },
            userIds: [wallet.ownerId],
          },
        },
        ...(command.reason
          ? [
              {
                type: 'TransferFailed',
                payload: {
                  transferId: active.transferId,
                  walletId: wallet.id,
                  reason: command.reason,
                },
                metadata,
                publish: {
                  payload: {
                    transferId: active.transferId,
                    reason: command.reason,
                    ...snapshot,
                  },
                  userIds: [wallet.ownerId],
                },
              },
            ]
          : []),
      ],
      balances: after,
      operation: {
        operationId: command.operationId,
        type: 'release',
        request,
        result,
      },
    });
    return result;
  }

  // Холду ще немає: запит place міг застрягти й вийти за таймаут саги, але
  // ще виконується. Під блокуванням гаманця (того самого, що бере place)
  // перечитуємо холд: з'явився — знімаємо як звичайно, ні — лишаємо слід,
  // і запізнілий place отримає HOLD_NOT_ACTIVE.
  private async releaseUnplaced(
    manager: EntityManager,
    holdId: string,
    command: ReleaseHoldCommand,
    request: unknown,
  ): Promise<HoldView> {
    const walletId = command.walletId as string;
    const balances = await lockBalances(manager, [walletId]);
    if (!balances[walletId]) {
      throw ledgerNotFound('Гаманець не знайдено');
    }
    const done = await findCompletedOperation<HoldView>(
      manager,
      command.operationId,
      request,
    );
    if (done) return done;
    if (await manager.findOne(Hold, { where: { holdId } })) {
      // Place встиг закомітитись, поки чекали блокування.
      return this.releaseIn(manager, holdId, command, request);
    }
    const result: HoldView = { holdId, status: 'RELEASED' };
    await manager
      .createQueryBuilder()
      .insert()
      .into(Operation)
      .values([
        {
          operationId: releasedBeforePlaced(holdId),
          type: 'release_unplaced',
          requestHash: hashRequest({ holdId }),
          result,
        },
        {
          operationId: command.operationId,
          type: 'release',
          requestHash: hashRequest(request),
          result,
        },
      ])
      .orIgnore()
      .execute();
    return result;
  }

  // Захоплення холду атомарно: списання з held відправника й зарахування
  // отримувачу (між валютами — через system:fx:*) в одній транзакції.
  async capture(
    holdId: string,
    command: CaptureHoldCommand,
  ): Promise<HoldView> {
    const request = { holdId, ...command };
    const toAmountMinor = BigInt(command.toAmountMinor);
    return this.dataSource
      .transaction(async (manager) => {
        const { hold: active, balances } = await this.lockHold(
          manager,
          holdId,
          [command.toWalletId],
        );
        const done = await findCompletedOperation<HoldView>(
          manager,
          command.operationId,
          request,
        );
        if (done) return done;
        assertActive(active);

        const sender = await this.findWallet(manager, active.walletId);
        const recipient = await this.findWallet(manager, command.toWalletId);
        // Заморожений гаманець гроші не віддає; холд на ньому можна лише зняти.
        if (sender.frozen) {
          throw ledgerConflict('WALLET_FROZEN', 'Гаманець відправника заморожено');
        }
        if (recipient.currency !== command.toCurrency) {
          throw ledgerConflict('CURRENCY_MISMATCH', 'Інша валюта отримувача');
        }
        if (recipient.frozen) {
          throw ledgerConflict(
            'RECIPIENT_FROZEN',
            'Гаманець отримувача заморожено',
          );
        }
        const amountMinor = BigInt(active.amountMinor);
        if (
          sender.currency === recipient.currency &&
          amountMinor !== toAmountMinor
        ) {
          throw new BadRequestException(
            'В одній валюті сума зарахування має дорівнювати сумі холду',
          );
        }
        // Між валютами сума зарахування = сума холду × fxRate (±1 мінорна
        // одиниця на округлення). Інакше різницю мовчки поглинули б
        // system:fx:*, і звірка її не побачила б.
        if (
          sender.currency !== recipient.currency &&
          Math.abs(
            Number(toAmountMinor) -
              Math.round(Number(amountMinor) * command.fxRate),
          ) > 1
        ) {
          throw new BadRequestException(
            'Сума зарахування не відповідає курсу fxRate',
          );
        }
        const postings = capturePostings(
          {
            walletId: sender.id,
            currency: sender.currency,
            amountMinor,
          },
          {
            walletId: recipient.id,
            currency: recipient.currency,
            amountMinor: toAmountMinor,
          },
        );
        const after = applyPostings(balances, postings);
        await manager.update(Hold, { holdId }, { status: 'CAPTURED' });
        const result: HoldView = { holdId, status: 'CAPTURED' };
        await commitChange(manager, this.eventStore, {
          streamId: sender.id,
          events: [
            {
              type: 'TransferCompleted',
              payload: {
                transferId: active.transferId,
                holdId,
                from: {
                  walletId: sender.id,
                  currency: sender.currency,
                  amountMinor: active.amountMinor,
                },
                to: {
                  walletId: recipient.id,
                  currency: recipient.currency,
                  amountMinor: command.toAmountMinor,
                },
                fxRate: command.fxRate,
                postings,
              },
              metadata: {
                operationId: command.operationId,
                transferId: active.transferId,
                traceparent: currentTraceparent(),
              },
              publish: {
                payload: {
                  transferId: active.transferId,
                  from: walletPayload(sender, amountMinor, after[sender.id]),
                  to: walletPayload(
                    recipient,
                    toAmountMinor,
                    after[recipient.id],
                  ),
                },
                userIds: [sender.ownerId, recipient.ownerId],
              },
            },
          ],
          balances: after,
          operation: {
            operationId: command.operationId,
            type: 'capture',
            request,
            result,
          },
        });
        return result;
      })
      .catch(rethrowOperationConflict);
  }

  private async findWallet(
    manager: EntityManager,
    walletId: string,
  ): Promise<Wallet> {
    const wallet = await manager.findOne(Wallet, { where: { id: walletId } });
    if (!wallet) {
      throw ledgerNotFound('Гаманець не знайдено');
    }
    return wallet;
  }

  // Холд змінюється лише під блокуванням гаманця відправника, тому його
  // перечитуємо вже після lockBalances — повернений стан актуальний.
  private async lockHold(
    manager: EntityManager,
    holdId: string,
    otherWalletIds: string[],
  ): Promise<{ hold: Hold; balances: Balances }> {
    const unlocked = await manager.findOne(Hold, { where: { holdId } });
    if (!unlocked) {
      throw ledgerNotFound('Холд не знайдено');
    }
    const balances = await lockBalances(manager, [
      unlocked.walletId,
      ...otherWalletIds,
    ]);
    for (const id of otherWalletIds) {
      if (!balances[id]) {
        throw ledgerNotFound('Гаманець не знайдено');
      }
    }
    const hold = await manager.findOneOrFail(Hold, { where: { holdId } });
    return { hold, balances };
  }
}

function assertActive(hold: Hold): void {
  if (hold.status !== 'ACTIVE') {
    throw ledgerConflict('HOLD_NOT_ACTIVE', `Холд уже ${hold.status}`);
  }
}
