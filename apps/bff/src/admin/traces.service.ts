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

// Кожна сага переказу починається з кроку RISK_CHECK, тож trace з цим span'ом —
// trace саги, хоч би з якого запиту вона стартувала (переказ, оплата частки).
const SAGA_START_OPERATION = 'saga.step RISK_CHECK';

// Початок trace — найраніший span (запит, з якого стартувала сага).
const startOf = (item: JaegerTrace) =>
  item.spans.reduce(
    (min, span) => Math.min(min, span.startTime),
    item.spans[0]?.startTime ?? 0,
  );

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
        operation: SAGA_START_OPERATION,
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
    // Jaeger не гарантує порядку: найновіші трейси першими.
    return response.data.data
      .map((item) => ({ item, started: startOf(item) }))
      .sort((a, b) => b.started - a.started)
      .map(({ item }) => ({
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
