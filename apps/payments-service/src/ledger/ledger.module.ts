import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { httpBudget } from '../common/http-budget';
import { LedgerClient } from './ledger.client';

@Module({
  imports: [
    HttpModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        baseURL: config.getOrThrow<string>('LEDGER_SERVICE_URL'),
        // Запит обривається разом з таймаутом breaker'а, а не висить далі.
        timeout: httpBudget(config.getOrThrow<number>('CB_TIMEOUT_MS')),
        headers: {
          'x-internal-token': config.getOrThrow<string>('INTERNAL_API_TOKEN'),
        },
      }),
    }),
  ],
  providers: [LedgerClient],
  exports: [LedgerClient],
})
export class LedgerModule {}
