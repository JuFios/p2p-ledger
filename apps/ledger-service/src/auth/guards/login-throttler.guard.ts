import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';

// Ліміт спроб логіну за email: підбір пароля до конкретного акаунта.
// Окремий іменований ліміт 'ip' (app.module) рахує спроби за clientIp —
// один пароль по багатьох акаунтах (password spraying).
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: {
    body?: { email?: unknown };
    ip: string;
  }): Promise<string> {
    const email = req.body?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : req.ip;
  }

  // Іменований ліміт ставить Retry-After-ip; BFF і frontend читають Retry-After.
  protected async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    context
      .switchToHttp()
      .getResponse<{ header(name: string, value: number): void }>()
      .header('Retry-After', detail.timeToBlockExpire);
    return super.throwThrottlingException(context, detail);
  }
}

// IP клієнта визначає frontend (перший hop) і передає через BFF у
// x-forwarded-for; береться останній запис — його додає найближчий proxy.
// Без заголовка (прямий виклик) — адреса з'єднання.
export function clientIp(req: Record<string, unknown>): string {
  const headers = req.headers as Record<string, unknown> | undefined;
  const forwarded = headers?.['x-forwarded-for'];
  const last =
    typeof forwarded === 'string' ? forwarded.split(',').pop()?.trim() : '';
  return last || String(req.ip);
}
