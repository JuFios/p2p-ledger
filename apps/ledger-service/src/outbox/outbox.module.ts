import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { OutboxRelay } from './outbox-relay.service';

@Module({
  imports: [RedisModule],
  providers: [OutboxRelay],
})
export class OutboxModule {}
