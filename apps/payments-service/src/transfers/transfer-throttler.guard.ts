import { Injectable } from '@nestjs/common';
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
}
