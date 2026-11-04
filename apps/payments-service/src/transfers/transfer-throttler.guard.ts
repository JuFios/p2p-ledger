import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Ліміт створення переказів рахується за userId з JWT, а не за IP: усі
// запити приходять через BFF з однієї адреси.
@Injectable()
export class TransferThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: {
    user?: { userId?: string };
    ip: string;
  }): Promise<string> {
    return req.user?.userId ?? req.ip;
  }

  // Стандартний ключ містить контролер і хендлер, тож POST /transfers і
  // оплата частки мали б окремі ліміти. Обидва створюють переказ — ліміт один.
  protected generateKey(
    _context: ExecutionContext,
    tracker: string,
    name: string,
  ): string {
    return `transfer-create-${name}-${tracker}`;
  }
}
