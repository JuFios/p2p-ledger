import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();

  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }

  onModuleDestroy() {
    this.registry.clear();
  }
}
