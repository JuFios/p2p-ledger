import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { SplitBillsController } from './split-bills.controller';
import { SplitBillsService } from './split-bills.service';

@Module({
  imports: [LedgerModule],
  controllers: [SplitBillsController],
  providers: [SplitBillsService],
  exports: [SplitBillsService],
})
export class SplitBillsModule {}
