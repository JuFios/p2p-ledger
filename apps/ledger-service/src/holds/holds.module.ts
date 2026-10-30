import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { HoldsService } from './holds.service';

@Module({
  imports: [LedgerModule],
  providers: [HoldsService],
  exports: [HoldsService],
})
export class HoldsModule {}
