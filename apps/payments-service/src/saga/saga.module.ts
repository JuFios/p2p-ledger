import { Module } from '@nestjs/common';
import { FxModule } from '../fx/fx.module';
import { LedgerModule } from '../ledger/ledger.module';
import { SagaRunner } from './saga-runner.service';
import { TransferSaga } from './transfer-saga';

@Module({
  imports: [LedgerModule, FxModule],
  providers: [TransferSaga, SagaRunner],
})
export class SagaModule {}
