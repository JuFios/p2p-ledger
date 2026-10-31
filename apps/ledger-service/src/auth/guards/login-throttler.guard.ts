import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

// Ліміт спроб логіну рахується за email, а не за IP: усі запити приходять
// через BFF з однієї адреси, а підбір пароля йде до конкретного акаунта.
@Injectable()
export class LoginThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: {
    body?: { email?: unknown };
    ip: string;
  }): Promise<string> {
    const email = req.body?.email;
    return typeof email === 'string' ? email.trim().toLowerCase() : req.ip;
  }
}
