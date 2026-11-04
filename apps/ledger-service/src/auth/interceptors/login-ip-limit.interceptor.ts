import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { Observable, catchError, tap, throwError } from 'rxjs';

interface Window {
  failures: number;
  resetAt: number;
}

// Ліміт невдалих входів з одного IP клієнта — проти перебору одного пароля
// по багатьох акаунтах. Спроба резервується до перевірки пароля (паралельні
// запити не проскочать ліміт) і повертається, якщо відповідь не 401: успішні
// входи людей за спільним NAT не витрачають ліміт. Лічильник — у пам'яті
// процесу, як і в ThrottlerGuard за email.
@Injectable()
export class LoginIpLimitInterceptor implements NestInterceptor {
  private readonly windows = new Map<string, Window>();
  private readonly limit: number;
  private readonly ttlMs: number;
  private nextSweepAt = 0;

  constructor(config: ConfigService) {
    this.limit = Number(config.get('LOGIN_IP_RATE_LIMIT', 20));
    this.ttlMs = Number(config.get('LOGIN_RATE_TTL_MS', 60000));
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const ip = clientIp(http.getRequest<Request>());
    const now = Date.now();
    this.sweep(now);
    let window = this.windows.get(ip);
    if (!window || window.resetAt <= now) {
      window = { failures: 0, resetAt: now + this.ttlMs };
      this.windows.set(ip, window);
    }
    if (window.failures >= this.limit) {
      http
        .getResponse<Response>()
        .setHeader('Retry-After', Math.ceil((window.resetAt - now) / 1000));
      throw new ThrottlerException();
    }
    window.failures++;
    const reserved = window;
    const refund = () => {
      if (this.windows.get(ip) === reserved) reserved.failures--;
    };
    return next.handle().pipe(
      tap(refund),
      catchError((error: unknown) => {
        if (!(error instanceof UnauthorizedException)) refund();
        return throwError(() => error);
      }),
    );
  }

  // Прибирає завершені вікна не частіше, ніж раз на вікно.
  private sweep(now: number) {
    if (now < this.nextSweepAt) return;
    for (const [ip, window] of this.windows)
      if (window.resetAt <= now) this.windows.delete(ip);
    this.nextSweepAt = now + this.ttlMs;
  }
}

// IP клієнта визначає frontend (перший hop) і передає через BFF у
// x-forwarded-for; береться останній запис — його додає найближчий proxy.
// Без заголовка (прямий виклик) — адреса з'єднання.
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  const last =
    typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : '';
  return last || req.ip || '';
}
