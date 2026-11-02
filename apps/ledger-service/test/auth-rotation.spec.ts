import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';

describe('Refresh token rotation', () => {
  let service: AuthService;
  const credentials = { email: 'rotation@example.com', password: 'password123' };
  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access';
    process.env.JWT_REFRESH_SECRET = 'test-refresh';
    let user: User | undefined;
    const repo = {
      findOne: jest.fn(async () => user && { ...user }),
      create: (value: Partial<User>) => ({
        id: 'rotation-user', role: 'user', ...value,
      }),
      save: jest.fn(async (value: User) => {
        user = { ...value };
        return value;
      }),
    };
    service = new AuthService(repo as unknown as Repository<User>, new JwtService());
  });
  it('rejects the previous token after refresh, including within the same second', async () => {
    const first = await service.register(credentials);
    const next = await service.refresh(first.refreshToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow('відкликано');
    await expect(service.refresh(next.refreshToken)).resolves.toHaveProperty('accessToken');
  });
  it('rejects the previous token after another login', async () => {
    const first = await service.register(credentials);
    const next = await service.login(credentials);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow('відкликано');
  });
});
