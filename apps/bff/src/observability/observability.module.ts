import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { context, isSpanContextValid, trace } from '@opentelemetry/api';
import { LoggerModule } from 'nestjs-pino';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { TracingShutdown } from './tracing-shutdown';

@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', 'info'),
          redact: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-internal-token"]',
            'res.headers["set-cookie"]',
          ],
          mixin: () => {
            const span = trace.getSpanContext(context.active());
            return {
              trace_id: span && isSpanContextValid(span) ? span.traceId : null,
              span_id: span && isSpanContextValid(span) ? span.spanId : null,
            };
          },
        },
      }),
    }),
  ],
  controllers: [MetricsController],
  providers: [MetricsService, TracingShutdown],
  exports: [MetricsService],
})
export class ObservabilityModule {}
