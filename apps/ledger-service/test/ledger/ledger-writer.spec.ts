import { ConflictException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { hashRequest } from '../../src/ledger/ledger-writer';
import { rethrowOperationConflict } from '../../src/ledger/ledger-errors';

describe('hashRequest', () => {
  it('не залежить від порядку ключів, зокрема вкладених', () => {
    expect(hashRequest({ a: 1, b: { c: 'x', d: [1, 2] } })).toBe(
      hashRequest({ b: { d: [1, 2], c: 'x' }, a: 1 }),
    );
  });

  it('розрізняє різні значення й порядок елементів масиву', () => {
    expect(hashRequest({ a: 1 })).not.toBe(hashRequest({ a: 2 }));
    expect(hashRequest({ a: [1, 2] })).not.toBe(hashRequest({ a: [2, 1] }));
  });
});

describe('rethrowOperationConflict', () => {
  const uniqueViolation = (table: string) =>
    new QueryFailedError('INSERT', [], {
      code: '23505',
      table,
    } as unknown as Error);

  it('паралельний дубль holdId → 409 HOLD_NOT_ACTIVE, а не 500', () => {
    expect.assertions(2);
    try {
      rethrowOperationConflict(uniqueViolation('holds'));
    } catch (error) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'HOLD_NOT_ACTIVE',
      });
    }
  });

  it('інші помилки прокидає без змін', () => {
    const error = uniqueViolation('events');
    expect(() => rethrowOperationConflict(error)).toThrow(error);
  });
});
