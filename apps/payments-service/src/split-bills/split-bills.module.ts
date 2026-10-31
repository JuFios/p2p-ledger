import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { TransfersModule } from '../transfers/transfers.module';
import { SplitBillsController } from './split-bills.controller';
import { SplitBillsService } from './split-bills.service';
import { SplitOverdueWorker } from './split-overdue.service';

@Module({
  imports: [LedgerModule, TransfersModule],
  controllers: [SplitBillsController],
  providers: [SplitBillsService, SplitOverdueWorker],
  exports: [SplitBillsService],
})
export class SplitBillsModule {}
