import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WalletsService } from '../src/wallets/wallets.service';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { WalletBalance } from '../src/wallets/entities/wallet-balance.entity';
import { EventStore } from '../src/ledger/event-store';

describe('WalletsService', () => {
  let service: WalletsService;
  let manager: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    update: jest.Mock;
    insert: jest.Mock;
  };
  let eventStore: { streamVersion: jest.Mock; append: jest.Mock };

  beforeEach(async () => {
    manager = {
      findOne: jest.fn().mockResolvedValue({
        id: 'wallet-1',
        ownerId: 'user-1',
        currency: 'USD',
        frozen: false,
      }),
      // заблокований рядок проєкції: 100.00 доступно
      findOneOrFail: jest.fn().mockResolvedValue({
        walletId: 'wallet-1',
        available: '10000',
        held: '0',
      }),
      update: jest.fn(),
      insert: jest.fn(),
    };
    eventStore = {
      streamVersion: jest.fn().mockResolvedValue(3),
      append: jest.fn(async (_m, _s, _v, events) =>
        events.map((e: object) => ({
          ...e,
          eventId: 'event-1',
          globalPosition: '42',
        })),
      ),
    };
    const dataSource = {
      transaction: jest.fn(async (cb) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: {} },
        { provide: DataSource, useValue: dataSource },
        { provide: EventStore, useValue: eventStore },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  it('increases balance on deposit', async () => {
    const result = await service.deposit('user-1', 'wallet-1', 50);

    // баланс читається під блокуванням рядка проєкції
    expect(manager.findOneOrFail).toHaveBeenCalledWith(
      WalletBalance,
      expect.objectContaining({ lock: { mode: 'pessimistic_write' } }),
    );
    expect(eventStore.append).toHaveBeenCalledWith(manager, 'wallet-1', 3, [
      expect.objectContaining({
        type: 'MoneyDeposited',
        payload: expect.objectContaining({
          amountMinor: '5000',
          postings: [
            expect.objectContaining({
              account: 'system:external:USD',
              direction: 'DEBIT',
            }),
            expect.objectContaining({
              account: 'wallet:wallet-1:available',
              direction: 'CREDIT',
            }),
          ],
        }),
      }),
    ]);
    expect(manager.update).toHaveBeenCalledWith(
      WalletBalance,
      { walletId: 'wallet-1' },
      { available: '15000', held: '0', lastPosition: '42' },
    );
    expect(result.balance).toBe('150.00');
  });

  it('does not allow withdrawing more than the current balance', async () => {
    expect.assertions(4);
    await expect(
      service.withdraw('user-1', 'wallet-1', 100.01),
    ).rejects.toBeInstanceOf(BadRequestException);
    // нічого не записано: ні події, ні проєкції, ні outbox
    expect(eventStore.append).not.toHaveBeenCalled();
    expect(manager.update).not.toHaveBeenCalled();
    expect(manager.insert).not.toHaveBeenCalled();
  });

  it('hides a wallet that belongs to someone else', async () => {
    expect.assertions(4);
    manager.findOne.mockResolvedValueOnce(null);
    await expect(
      service.withdraw('user-2', 'wallet-1', 10),
    ).rejects.toBeInstanceOf(NotFoundException);
    // пошук власника саме за парою { id, ownerId }, а не лише за id
    expect(manager.findOne).toHaveBeenCalledWith(
      Wallet,
      expect.objectContaining({ where: { id: 'wallet-1', ownerId: 'user-2' } }),
    );
    expect(manager.findOneOrFail).not.toHaveBeenCalled();
    expect(eventStore.append).not.toHaveBeenCalled();
  });
});
