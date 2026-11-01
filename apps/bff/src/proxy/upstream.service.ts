import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { Method } from 'axios';

const SOURCES = {
  ledger: 'LEDGER_SERVICE_URL',
  payments: 'PAYMENTS_SERVICE_URL',
  notifications: 'NOTIFICATIONS_SERVICE_URL',
  jaeger: 'JAEGER_QUERY_URL',
} as const;
export type Source = keyof typeof SOURCES;
export type ProxyRequest = Pick<Request, 'headers'>;

@Injectable()
export class UpstreamService {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

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
    }
    try {
      return await this.http.axiosRef.request<T>({
        url:
          this.config.getOrThrow<string>(SOURCES[source]).replace(/\/$/, '') +
          path,
        method: options.method ?? 'GET',
        data: options.body,
        params: options.query,
        headers,
        timeout: 2500,
        maxRedirects: 0,
        validateStatus: () => true,
      });
    } catch {
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
