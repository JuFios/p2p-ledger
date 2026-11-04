import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { UpstreamService } from '../proxy/upstream.service';

interface JaegerSpan {
  spanID: string;
  operationName: string;
  startTime: number;
  duration: number;
  processID: string;
  tags?: { key: string; value: unknown }[];
}
interface JaegerTrace {
  traceID: string;
  spans: JaegerSpan[];
  processes: Record<string, { serviceName: string }>;
}

// Кореневі операції, з яких стартує сага переказу: сам переказ і оплата
// частки split-рахунку (traceparent переказу береться із запиту).
export const SAGA_OPERATIONS = [
  'POST /transfers',
  'POST /split-bills/:id/shares/:shareId/pay',
];

const traceStart = (item: JaegerTrace) =>
  Math.min(...item.spans.map((span) => span.startTime));

@Injectable()
export class TracesService {
  constructor(private readonly upstream: UpstreamService) {}

  async list(limit = 10) {
    const found = await Promise.all(
      SAGA_OPERATIONS.map((operation) => this.find(operation, limit)),
    );
    // Найновіші трейси з обох операцій разом, не більше limit.
    return [...new Map(found.flat().map((item) => [item.traceID, item])).values()]
      .sort((a, b) => traceStart(b) - traceStart(a))
      .slice(0, limit)
      .map((item) => ({
        traceId: item.traceID,
        spans: item.spans
          .filter(
            (span) =>
              span.operationName.startsWith('saga.step ') &&
              item.processes[span.processID]?.serviceName === 'payments-service',
          )
          .sort((a, b) => a.startTime - b.startTime)
          .map((span) => ({
            spanId: span.spanID,
            operationName: span.operationName,
            startTime: span.startTime,
            // Jaeger повертає мікросекунди; кожна спроба кроку має окремий span.
            durationMs: span.duration / 1000,
            transferId:
              span.tags?.find((tag) => tag.key === 'transfer.id')?.value ?? null,
          })),
      }));
  }

  private async find(operation: string, limit: number) {
    const response = await this.upstream.request<{
      data: JaegerTrace[];
      errors?: unknown[] | null;
    }>('jaeger', '/api/traces', {
      query: { service: 'payments-service', operation, limit },
    });
    if (
      response.status !== 200 ||
      !Array.isArray(response.data?.data) ||
      response.data.errors?.length
    ) {
      throw new ServiceUnavailableException('Trace backend unavailable');
    }
    return response.data.data;
  }
}
