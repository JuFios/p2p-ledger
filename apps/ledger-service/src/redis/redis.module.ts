import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const REDIS_COMMAND_TIMEOUT_MS = 5000;
const REDIS_MAX_RETRIES = 3;

export const REDIS = Symbol('REDIS');

@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        new Redis({
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
          // Команда не висить вічно, поки Redis недоступний: relay тримає
          // відкриту транзакцію БД, доки чекає на XADD.
          maxRetriesPerRequest: REDIS_MAX_RETRIES,
          commandTimeout: REDIS_COMMAND_TIMEOUT_MS,
        }),
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  // Без з'єднання QUIT чекав би таймауту команди й падав, тож розриваємо одразу.
  async onApplicationShutdown() {
    if (this.redis.status !== 'ready') {
      this.redis.disconnect();
      return;
    }
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}
