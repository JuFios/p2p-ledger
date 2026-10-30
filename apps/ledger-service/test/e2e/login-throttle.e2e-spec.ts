import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp, registerUser } from './helpers';

describe('Login rate limit (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  const login = (email: string, password: string) =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  it('обмежує спроби логіну за email, не зачіпаючи інші акаунти', async () => {
    const limit = Number(process.env.LOGIN_RATE_LIMIT);
    const victim = await registerUser(app);
    const other = await registerUser(app);

    for (let i = 0; i < limit; i++) {
      await login(victim.email, 'wrong-password').expect(401);
    }
    await login(victim.email, 'wrong-password').expect(429);
    // Правильний пароль теж чекає кінця вікна.
    await login(victim.email, 'password123').expect(429);
    await login(other.email, 'password123').expect(201);
  });
});
