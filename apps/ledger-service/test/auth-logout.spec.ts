import { createHash } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';

describe('Session logout', () => {
  const jwt = new JwtService();
  const secret = 'logout-test-secret';
  let service: AuthService;
  let user: { id: string; refreshTokenHash: string | null };
  let update: jest.Mock;
  const token = (id = 'user', expired = false) => jwt.sign({ sub: id }, { secret, expiresIn: expired ? -1 : 60, jwtid: Math.random().toString() });
  beforeEach(() => {
    process.env.JWT_REFRESH_SECRET = secret;
    user = { id: 'user', refreshTokenHash: null };
    update = jest.fn(async (where, value) => {
      if (where.refreshTokenHash === user.refreshTokenHash) Object.assign(user, value);
    });
    service = new AuthService({ findOne: async () => ({ ...user }), update } as unknown as Repository<User>, jwt);
  });
  it('revokes only the matching current token', async () => {
    const current = token();
    user.refreshTokenHash = createHash('sha256').update(current).digest('hex');
    await service.logout(current);
    expect(user.refreshTokenHash).toBeNull();
    expect(update).toHaveBeenCalledTimes(1);
  });
  it('ignores replaced, expired and invalid tokens', async () => {
    user.refreshTokenHash = createHash('sha256').update(token()).digest('hex');
    const original = user.refreshTokenHash;
    for (const old of [token(), token('user', true), 'garbage']) await service.logout(old);
    expect(user.refreshTokenHash).toBe(original);
    expect(update).not.toHaveBeenCalled();
  });
});
