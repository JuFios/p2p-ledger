import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

// Недоступний Redis — деградація, а не відмова: запис у ledger від нього не
// залежить (інтеграційні події чекають в outbox), тож статус показуємо,
// але health загалом не валимо.
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.redis.ping();
      return this.getStatus(key, true);
    } catch {
      return this.getStatus(key, false, {
        message: 'Redis недоступний: події чекають в outbox',
      });
    }
  }
}
