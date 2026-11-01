import 'dotenv/config';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { ConfigService } from '@nestjs/config';
import { registerTracingShutdown } from './observability/tracing-shutdown';

// SDK стартує до завантаження HTTP, ORM, Redis і логера застосунку.
const config = new ConfigService();
const sdk = new NodeSDK({
  serviceName: config.get('OTEL_SERVICE_NAME', 'notifications-service'),
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      '@opentelemetry/instrumentation-pg': { requireParentSpan: true },
      '@opentelemetry/instrumentation-ioredis': { requireParentSpan: true },
      '@opentelemetry/instrumentation-pino': { disableLogSending: true },
    }),
  ],
});
sdk.start();
registerTracingShutdown(() => sdk.shutdown());
