import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}

  // Індикатори (БД, Redis) з'являться разом із відповідними залежностями.
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([]);
  }
}
