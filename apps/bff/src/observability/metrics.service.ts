import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Registry } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  constructor() {
    collectDefaultMetrics({ register: this.registry });
  }
}
