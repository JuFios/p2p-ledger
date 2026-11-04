import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { JwtStrategy } from '../src/auth/jwt.strategy';

// Контракт перевірки access-токена однаковий в усіх сервісах, що його читають.
const secret = 'contract-access-secret';
const strategy = new JwtStrategy(
  new ConfigService({ JWT_ACCESS_SECRET: secret }),
);
const jwt = new JwtService({ secret });
const userId = '11111111-1111-4111-8111-111111111111';

// Виклик passport-стратегії напряму: success → користувач, fail/error → false.
function authenticate(token: string): Promise<unknown> {
  return new Promise((resolve) => {
    const attempt = Object.assign(Object.create(strategy), {
      success: (user: unknown) => resolve(user),
      fail: () => resolve(false),
      error: () => resolve(false),
    });
    attempt.authenticate({ headers: { authorization: `Bearer ${token}` } });
  });
}

describe('JwtStrategy', () => {
  it('приймає HS256-токен ledger з UUID у sub', async () => {
    const token = jwt.sign({ sub: userId, email: 'a@example.com', role: 'user' });
    await expect(authenticate(token)).resolves.toEqual({
      userId,
      email: 'a@example.com',
      role: 'user',
    });
  });

  it('відхиляє токен, чий sub не UUID', async () => {
    const token = jwt.sign({ sub: 'not-a-uuid', email: 'a@example.com', role: 'user' });
    await expect(authenticate(token)).resolves.toBe(false);
  });

  it('відхиляє інший алгоритм підпису навіть зі спільним секретом', async () => {
    const token = jwt.sign(
      { sub: userId, email: 'a@example.com', role: 'user' },
      { algorithm: 'HS512' },
    );
    await expect(authenticate(token)).resolves.toBe(false);
  });
});
