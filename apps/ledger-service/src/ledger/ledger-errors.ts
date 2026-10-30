import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

// Остаточні відмови ledger: тіло { code, message }, щоб викликач (сага)
// відрізняв їх від невизначеного результату (5xx/таймаут) за кодом.
export type LedgerErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'WALLET_FROZEN'
  | 'RECIPIENT_FROZEN'
  | 'OWNER_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'HOLD_NOT_ACTIVE';

export function ledgerConflict(code: LedgerErrorCode, message: string) {
  return new ConflictException({ code, message });
}

export function ledgerNotFound(message: string) {
  return new NotFoundException({ code: 'NOT_FOUND', message });
}

// Той самий operationId / Idempotency-Key з іншим тілом запиту.
export function idempotencyKeyReused() {
  return new UnprocessableEntityException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Ключ ідемпотентності вже використано з іншими параметрами',
  });
}

// Два паралельні запити з тим самим ключем, але на різні гаманці, не
// серіалізуються блокуванням гаманця: другий впирається в PK operations.
// Це завжди різні параметри (гаманець входить у хеш запиту).
export function rethrowOperationConflict(error: unknown): never {
  if (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string; table?: string }).code === '23505' &&
    (error.driverError as { table?: string }).table === 'operations'
  ) {
    throw idempotencyKeyReused();
  }
  throw error;
}
