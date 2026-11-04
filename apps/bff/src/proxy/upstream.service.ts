import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Method } from 'axios';
import { Request, Response } from 'express';
import { httpBudget } from '../common/http-budget';

const SOURCES = {
  ledger: 'LEDGER_SERVICE_URL',
  payments: 'PAYMENTS_SERVICE_URL',
  notifications: 'NOTIFICATIONS_SERVICE_URL',
  jaeger: 'JAEGER_QUERY_URL',
} as const;
export type Source = keyof typeof SOURCES;
export type ProxyRequest = Pick<Request, 'headers'> & Partial<Pick<Request, 'ip'>>;

function failureCategory(error: unknown) {
  const code = (error as { code?: string })?.code;
  const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT';
  const dnsFailure = code === 'ENOTFOUND' || code === 'EAI_AGAIN';
  if (timedOut) return 'timeout';
  if (code === 'ECONNREFUSED') return 'connection_refused';
  if (dnsFailure) return 'dns';
  return 'transport';
}

@Injectable()
export class UpstreamService {
  private readonly logger = new Logger(UpstreamService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {
    this.timeoutMs = httpBudget(config.get('CB_TIMEOUT_MS'), 'bff');
  }

  async request<T = unknown>(
    source: Source,
    path: string,
    options: {
      method?: Method;
      body?: unknown;
      query?: object;
      req?: ProxyRequest;
    } = {},
  ) {
    const headers: Record<string, string> = {};
    if (source !== 'jaeger') {
      for (const name of ['authorization', 'idempotency-key']) {
        const value = options.req?.headers[name];
        if (typeof value === 'string') headers[name] = value;
      }
      // IP клієнта для ліміту логіну в ledger: від frontend як є,
      // для прямого виклику BFF — адреса з'єднання.
      const forwarded = options.req?.headers['x-forwarded-for'];
      const clientIp = typeof forwarded === 'string' ? forwarded : options.req?.ip;
      if (clientIp) headers['x-forwarded-for'] = clientIp;
    }
    const started = Date.now();
    const method = options.method ?? 'GET';
    try {
      return await this.http.axiosRef.request<T>({
        url:
          this.config.getOrThrow<string>(SOURCES[source]).replace(/\/$/, '') +
          path,
        method,
        data: options.body,
        params: options.query,
        headers,
        timeout: this.timeoutMs,
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch (error) {
      this.logger.warn({
        category: failureCategory(error),
        source,
        method,
        path: path.split('?')[0],
        durationMs: Date.now() - started,
      }, 'Upstream request failed');
      throw new ServiceUnavailableException('Upstream service unavailable');
    }
  }

  async forward(
    source: Source,
    path: string,
    req: ProxyRequest,
    res: Response,
    method: Method = 'GET',
    body?: unknown,
    query?: object,
  ) {
    const response = await this.request(source, path, {
      req,
      method,
      body,
      query,
    });
    for (const name of ['content-type', 'retry-after']) {
      const value = response.headers[name];
      if (typeof value === 'string') res.setHeader(name, value);
    }
    return res.status(response.status).send(response.data);
  }
}
