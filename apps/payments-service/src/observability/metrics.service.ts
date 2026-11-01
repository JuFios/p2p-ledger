import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Registry, Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();
  readonly transfers = new Counter({
    name: 'transfers_total',
    help: 'Перекази, що завершились у цьому процесі.',
    labelNames: ['status'],
    registers: [this.registry],
  });
  readonly stepDuration = new Histogram({
    name: 'saga_step_duration_seconds',
    help: 'Тривалість спроби кроку саги включно з фіксацією результату.',
    labelNames: ['step'],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleDestroy() {
    this.registry.clear();
  }
}
