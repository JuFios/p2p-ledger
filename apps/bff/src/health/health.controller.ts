import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthCheckService) {}
  @Get()
  @HealthCheck()
  check() {
    // BFF не має БД чи брокера; недоступне джерело деградує окрему секцію.
    return this.health.check([]);
  }
}
