import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { StreamConsumer } from './events/stream-consumer.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly consumer: StreamConsumer,
  ) {}
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.db.pingCheck('database'),
      () => ({
        redis: {
          status: this.consumer.redis.status === 'ready' ? 'up' : 'down',
        },
      }),
    ]);
  }
}
