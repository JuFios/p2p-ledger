import { UnprocessableEntityException } from '@nestjs/common';

// Повтор з тим самим Idempotency-Key має бути тим самим запитом, інакше 422.
export function assertSameRequest(storedHash: string | null, requestHash: string) {
  if (storedHash !== requestHash) {
    throw new UnprocessableEntityException({
      code: 'IDEMPOTENCY_KEY_REUSED',
      message: 'Ключ ідемпотентності вже використано з іншими параметрами',
    });
  }
}
