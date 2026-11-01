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

@Injectable()
export class TracesService {
  constructor(private readonly upstream: UpstreamService) {}

  async list(limit = 10) {
    const response = await this.upstream.request<{
      data: JaegerTrace[];
      errors?: unknown[] | null;
    }>('jaeger', '/api/traces', {
      query: {
        service: 'payments-service',
        operation: 'POST /transfers',
        limit,
      },
    });
    if (
      response.status !== 200 ||
      !Array.isArray(response.data?.data) ||
      response.data.errors?.length
    ) {
      throw new ServiceUnavailableException('Trace backend unavailable');
    }
    return response.data.data.map((item) => ({
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
}
