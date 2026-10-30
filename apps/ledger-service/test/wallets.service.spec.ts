import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { WalletsService } from '../src/wallets/wallets.service';
import { Wallet } from '../src/wallets/entities/wallet.entity';

describe('WalletsService', () => {
  let service: WalletsService;
  let walletsRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    walletsRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (w) => w),
      create: jest.fn((w) => w),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: walletsRepo },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  it('increases balance on deposit', async () => {
    walletsRepo.findOne.mockResolvedValueOnce({
      id: 'wallet-1',
      balance: '100.00',
    });
    const result = await service.deposit('wallet-1', 50);
    expect(result.balance).toBe('150.00');
  });

  it('does not allow withdrawing more than the current balance', async () => {
    walletsRepo.findOne.mockResolvedValueOnce({
      id: 'wallet-1',
      balance: '100.00',
    });
    service
      .withdraw('wallet-1', 500)
      .catch((err) => expect(err).toBeDefined());
  });
});
