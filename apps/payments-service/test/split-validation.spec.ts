import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource } from 'typeorm';
import { CreateSplitBillDto } from '../src/split-bills/dto/create-split-bill.dto';
import { LedgerClient } from '../src/ledger/ledger.client';
import { TransfersService } from '../src/transfers/transfers.service';
import { SplitBillsService } from '../src/split-bills/split-bills.service';

const body = {
  title: 'Dinner',
  totalAmount: 1,
  currency: 'USD',
  mode: 'CUSTOM',
  participants: [{ email: 'member@example.com', amount: null }],
};
it('rejects an explicit null participant amount at the HTTP boundary', () => {
  expect(validateSync(plainToInstance(CreateSplitBillDto, body))).not.toHaveLength(0);
});
it.each([undefined, 'same-key'])(
  'rejects null through ValidationPipe before hashing or database work (key=%s)',
  async (key) => {
    const db = {
      manager: { findOne: jest.fn().mockResolvedValue(null) },
      transaction: jest.fn(),
    };
    const service = new SplitBillsService(
      db as unknown as DataSource,
      {} as LedgerClient,
      {} as TransfersService,
      new ConfigService(),
    );
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const create = async () => {
      const dto = await pipe.transform(body, { type: 'body', metatype: CreateSplitBillDto });
      return service.create({ userId: 'owner', email: 'owner@example.com', role: 'user' }, dto, key);
    };
    await expect(create()).rejects.toBeInstanceOf(BadRequestException);
    expect(db.manager.findOne).not.toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
  },
);
