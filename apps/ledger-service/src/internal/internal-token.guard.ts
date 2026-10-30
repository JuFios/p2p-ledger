import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

// Міжсервісні виклики (/internal/*): лише з INTERNAL_API_TOKEN у заголовку
// x-internal-token. JWT користувача сюди не підходить. Без налаштованого
// токена ендпоінти закриті повністю.
@Injectable()
export class InternalTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const expected = this.config.get<string>('INTERNAL_API_TOKEN');
    const actual = ctx.switchToHttp().getRequest().headers['x-internal-token'];
    // Довжини порівнюємо в байтах: timingSafeEqual падає на буферах різної
    // довжини (не-ASCII символ займає більше одного байта).
    const actualBytes = Buffer.from(typeof actual === 'string' ? actual : '');
    const expectedBytes = Buffer.from(expected ?? '');
    if (
      !expected ||
      typeof actual !== 'string' ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)
    ) {
      throw new UnauthorizedException();
    }
    return true;
  }
}
