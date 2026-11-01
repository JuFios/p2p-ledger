import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { MetricsService } from '../src/observability/metrics.service';
import { ObservabilityModule } from '../src/observability/observability.module';

it('exposes Prometheus metrics without authentication and isolates application registries', async () => {
  const apps: INestApplication[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const module = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true }), ObservabilityModule],
      }).compile();
      const app = module.createNestApplication();
      apps.push(app);
      await app.init();
      const response = await request(app.getHttpServer()).get('/metrics').expect(200);
      expect(response.headers['content-type']).toContain('text/plain');
      expect(response.text).toContain('process_cpu_user_seconds_total');
      expect(response.text).toContain('nodejs_heap_size_used_bytes');
      expect(app.get(MetricsService).registry).toBeDefined();
    }
    expect(apps[0].get(MetricsService).registry).not.toBe(apps[1].get(MetricsService).registry);
  } finally {
    await Promise.all(apps.map((app) => app.close()));
  }
});
