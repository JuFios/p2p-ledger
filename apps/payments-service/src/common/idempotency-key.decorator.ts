import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';

// Заголовок Idempotency-Key (1–128 символів); без заголовка — undefined.
function readIdempotencyKey(ctx: ExecutionContext): string | undefined {
  const value = ctx.switchToHttp().getRequest().headers['idempotency-key'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new BadRequestException('Idempotency-Key must be 1–128 characters');
  }
  return value;
}

// Обов'язковий Idempotency-Key.
export const IdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const value = readIdempotencyKey(ctx);
    if (value === undefined) {
      throw new BadRequestException(
        'Idempotency-Key header is required (1–128 characters)',
      );
    }
    return value;
  },
);

// Необов'язковий Idempotency-Key.
export const OptionalIdempotencyKey = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    readIdempotencyKey(ctx),
);
