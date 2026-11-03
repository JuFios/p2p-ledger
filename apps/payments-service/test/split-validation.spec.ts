import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DataSource } from 'typeorm';
import { CreateSplitBillDto } from '../src/split-bills/dto/create-split-bill.dto';
import { SplitBillsService } from '../src/split-bills/split-bills.service';
import { LedgerClient } from '../src/ledger/ledger.client';
import { TransfersService } from '../src/transfers/transfers.service';

const body = { title: 'Dinner', totalAmount: 1, currency: 'USD', mode: 'CUSTOM', participants: [{ email: 'member@example.com', amount: null }] };
it('rejects an explicit null participant amount at the HTTP boundary', () => {
  expect(validateSync(plainToInstance(CreateSplitBillDto, body))).not.toHaveLength(0);
});
it.each([undefined, 'same-key'])('rejects null in the domain before hashing or database work (key=%s)', async (key) => {
  const db = { manager: { findOne: jest.fn().mockResolvedValue(null) }, transaction: jest.fn() };
  const service = new SplitBillsService(db as unknown as DataSource, {} as LedgerClient, {} as TransfersService, new ConfigService());
  await expect(service.create({ userId: 'owner', email: 'owner@example.com', role: 'user' }, body as unknown as CreateSplitBillDto, key)).rejects.toBeInstanceOf(BadRequestException);
  expect(db.manager.findOne).not.toHaveBeenCalled();
  expect(db.transaction).not.toHaveBeenCalled();
});
