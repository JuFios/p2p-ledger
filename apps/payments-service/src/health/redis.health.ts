import { Inject, Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS } from '../redis/redis.module';

// Недоступний Redis — деградація, а не відмова: сага від нього не
// залежить (інтеграційні події чекають в outbox), тож статус показуємо,
// але health загалом не валимо. Стан з'єднання беремо з клієнта без запиту:
// ping до Redis, що не відповідає, чекав би таймауту команди (5 с) — довше
// за таймаут healthcheck у docker-compose.
@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(@Inject(REDIS) private readonly redis: Redis) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    if (this.redis.status === 'ready') {
      return this.getStatus(key, true);
    }
    return this.getStatus(key, false, {
      message: 'Redis недоступний: події чекають в outbox',
    });
  }
}
