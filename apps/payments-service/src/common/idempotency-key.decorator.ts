import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

// Обов'язковий заголовок Idempotency-Key (1–128 символів).
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const value = ctx.switchToHttp().getRequest().headers['idempotency-key'];
    if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key header is required (1–128 characters)',
      );
    }
    return value;
  },
);
