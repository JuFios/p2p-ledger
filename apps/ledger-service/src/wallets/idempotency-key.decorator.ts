import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

// Опційний заголовок Idempotency-Key (1–128 символів).
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined => {
    const value = ctx.switchToHttp().getRequest().headers['idempotency-key'];
    if (value === undefined) {
      return undefined;
    }
    if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key must be 1–128 characters long',
      );
    }
    return value;
  },
);
