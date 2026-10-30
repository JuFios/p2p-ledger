import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { WalletsService } from '../src/wallets/wallets.service';
import { Wallet } from '../src/wallets/entities/wallet.entity';

describe('WalletsService', () => {
  let service: WalletsService;
  let manager: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    query: jest.Mock;
  };

  beforeEach(async () => {
    manager = {
      findOne: jest.fn().mockResolvedValue({ id: 'wallet-1' }),
      findOneOrFail: jest.fn(),
      query: jest.fn(),
    };
    const dataSource = {
      transaction: jest.fn(async (cb) => cb(manager)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: {} },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  it('increases balance on deposit', async () => {
    manager.findOneOrFail.mockResolvedValueOnce({
      id: 'wallet-1',
      balance: '150.00',
    });
    const result = await service.deposit('user-1', 'wallet-1', 50);
    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('balance + $1::numeric WHERE id = $2'),
      ['50.00', 'wallet-1'],
    );
    expect(result.balance).toBe('150.00');
  });

  it('does not allow withdrawing more than the current balance', async () => {
    expect.assertions(3);
    manager.query.mockResolvedValueOnce([{ sufficient: false }]);
    await expect(
      service.withdraw('user-1', 'wallet-1', 500),
    ).rejects.toBeInstanceOf(BadRequestException);
    // жодного UPDATE: був лише SELECT перевірки балансу
    expect(manager.query).toHaveBeenCalledTimes(1);
    expect(manager.findOneOrFail).not.toHaveBeenCalled();
  });

  it('hides a wallet that belongs to someone else', async () => {
    expect.assertions(3);
    manager.findOne.mockResolvedValueOnce(null);
    await expect(
      service.withdraw('user-2', 'wallet-1', 10),
    ).rejects.toBeInstanceOf(NotFoundException);
    // пошук власника саме за парою { id, ownerId }, а не лише за id
    expect(manager.findOne).toHaveBeenCalledWith(
      Wallet,
      expect.objectContaining({ where: { id: 'wallet-1', ownerId: 'user-2' } }),
    );
    expect(manager.query).not.toHaveBeenCalled();
  });
});
