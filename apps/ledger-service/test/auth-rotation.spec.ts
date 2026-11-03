import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthService } from '../src/auth/auth.service';
import { User } from '../src/auth/entities/user.entity';

describe('Refresh token rotation', () => {
  let service: AuthService;
  let user: User | undefined;
  let repo: {
    findOne: jest.Mock;
    create: (value: Partial<User>) => object;
    save: jest.Mock;
    update: jest.Mock;
  };
  const credentials = {
    email: 'rotation@example.com',
    password: 'password123',
  };
  beforeEach(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-access';
    process.env.JWT_REFRESH_SECRET = 'test-refresh';
    user = undefined;
    repo = {
      findOne: jest.fn(async () => user && { ...user }),
      create: (value: Partial<User>) => ({
        id: 'rotation-user',
        role: 'user',
        ...value,
      }),
      save: jest.fn(async (value: User) => {
        user = { ...value };
        return value;
      }),
      update: jest.fn(async (where, value) => {
        if (!user || Object.entries(where).some(([key, value]) => user![key as keyof User] !== value))
          return { affected: 0 };
        user = { ...user, ...value };
        return { affected: 1 };
      }),
    };
    service = new AuthService(
      repo as unknown as Repository<User>,
      new JwtService(),
    );
  });
  it('rejects the previous token after refresh, including within the same second', async () => {
    const first = await service.register(credentials);
    const next = await service.refresh(first.refreshToken);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      'відкликано',
    );
    await expect(service.refresh(next.refreshToken)).resolves.toHaveProperty(
      'accessToken',
    );
  });
  it('rejects the previous token after another login', async () => {
    const first = await service.register(credentials);
    const next = await service.login(credentials);
    expect(next.refreshToken).not.toBe(first.refreshToken);
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      'відкликано',
    );
  });
  it('allows only one concurrent rotation of a refresh token', async () => {
    const first = await service.register(credentials);
    const results = await Promise.allSettled([
      service.refresh(first.refreshToken),
      service.refresh(first.refreshToken),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
  });
  it('does not revive a session when logout wins against an in-flight refresh', async () => {
    const first = await service.register(credentials);
    let resume: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      resume = resolve;
    });
    repo.findOne.mockImplementationOnce(async () => {
      const snapshot = { ...user };
      await gate;
      return snapshot;
    });
    const rotating = service.refresh(first.refreshToken);
    await service.logout(first.refreshToken);
    resume();
    await expect(rotating).rejects.toThrow('відкликано');
    await expect(service.refresh(first.refreshToken)).rejects.toThrow(
      'відкликано',
    );
  });
  it('revokes the rotated session when refresh wins against an in-flight logout', async () => {
    const first = await service.register(credentials);
    const apply = repo.update.getMockImplementation()!;
    let resume: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const reached = new Promise<void>((resolve) => { started = resolve; });
    repo.update.mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return apply(...args);
    });
    const loggingOut = service.logout(first.refreshToken);
    await reached;
    const rotated = await service.refresh(first.refreshToken);
    resume();
    await loggingOut;
    await expect(service.refresh(rotated.refreshToken)).rejects.toThrow('відкликано');
  });
  it('revokes all rotations from the same login using its previous token', async () => {
    const first = await service.register(credentials);
    const rotated = await service.refresh(first.refreshToken);
    await service.logout(first.refreshToken);
    await expect(service.refresh(rotated.refreshToken)).rejects.toThrow('відкликано');
  });
  it('does not revoke a new login when an old logout completes late', async () => {
    const first = await service.register(credentials);
    const apply = repo.update.getMockImplementation()!;
    let resume: () => void = () => undefined;
    let started: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const reached = new Promise<void>((resolve) => { started = resolve; });
    repo.update.mockImplementationOnce(async (...args) => {
      started();
      await gate;
      return apply(...args);
    });
    const loggingOut = service.logout(first.refreshToken);
    await reached;
    const current = await service.login(credentials);
    resume();
    await loggingOut;
    await expect(service.refresh(current.refreshToken)).resolves.toHaveProperty('accessToken');
  });

  it('requires a fresh login for legacy bcrypt hashes rather than reopening prefix replay', async () => {
    const first = await service.register(credentials);
    user!.refreshTokenHash = await bcrypt.hash(first.refreshToken, 10);
    user!.refreshSessionId = null;
    await expect(service.refresh(first.refreshToken)).rejects.toThrow('відкликано');
    await expect(service.login(credentials)).resolves.toHaveProperty('refreshToken');
  });

});
