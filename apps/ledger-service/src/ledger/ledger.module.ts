import { Module } from '@nestjs/common';
import { EventStore } from './event-store';

@Module({
  providers: [EventStore],
  exports: [EventStore],
})
export class LedgerModule {}
