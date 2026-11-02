import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import request from 'supertest';
import { User } from '../../src/auth/entities/user.entity';
import { createApp } from './helpers';

describe('Refresh session revocation', () => {
  let app: INestApplication;
  let users: Repository<User>;
  beforeAll(async () => {
    app = await createApp();
    users = app.get(getRepositoryToken(User));
  });
  afterAll(async () => { await app?.close(); });
  const credentials = () => ({ email: `${randomUUID()}@example.com`, password: 'password123' });
  const post = (route: string, body: object) => request(app.getHttpServer()).post(`/auth/${route}`).send(body);

  it('revokes rotated tokens without revoking a later login', async () => {
    const login = credentials();
    const first = await post('register', login).expect(201);
    const rotated = await post('refresh', { refreshToken: first.body.refreshToken }).expect(201);
    await post('logout', { refreshToken: first.body.refreshToken }).expect(204);
    await post('refresh', { refreshToken: rotated.body.refreshToken }).expect(401);
    const next = await post('login', login).expect(201);
    await post('logout', { refreshToken: first.body.refreshToken }).expect(204);
    await post('refresh', { refreshToken: next.body.refreshToken }).expect(201);
  });

  it('revokes a rotation committed before an in-flight logout update', async () => {
    const first = await post('register', credentials()).expect(201);
    const update = users.update.bind(users);
    let resume: () => void = () => undefined;
    let reached: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    const started = new Promise<void>((resolve) => { reached = resolve; });
    const spy = jest.spyOn(users, 'update').mockImplementationOnce(async (where, value) => {
      reached();
      await gate;
      return update(where, value);
    });
    const loggingOut = post('logout', { refreshToken: first.body.refreshToken }).expect(204).then((res) => res);
    try {
      await started;
      const rotated = await post('refresh', { refreshToken: first.body.refreshToken }).expect(201);
      resume();
      await loggingOut;
      await post('refresh', { refreshToken: rotated.body.refreshToken }).expect(401);
    } finally {
      resume();
      spy.mockRestore();
    }
  });

  it('preserves refresh and logout for migrated tokens without a session claim', async () => {
    const login = credentials();
    await post('register', login).expect(201);
    const user = await users.findOneByOrFail({ email: login.email });
    const legacy = new JwtService().sign({ sub: user.id, email: user.email, role: user.role }, {
      secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d', jwtid: randomUUID(),
    });
    const hash = createHash('sha256').update(legacy).digest('hex');
    await users.update(user.id, { refreshTokenHash: hash, refreshSessionId: hash });
    const rotated = await post('refresh', { refreshToken: legacy }).expect(201);
    await post('logout', { refreshToken: legacy }).expect(204);
    await post('refresh', { refreshToken: rotated.body.refreshToken }).expect(401);
  });
});
