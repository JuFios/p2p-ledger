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

  const loginFrom = (forwardedFor: string, email: string, password: string) =>
    login(email, password).set('x-forwarded-for', forwardedFor);

  it('обмежує перебір одного пароля по різних акаунтах з одного IP', async () => {
    const limit = Number(process.env.LOGIN_IP_RATE_LIMIT);
    const user = await registerUser(app);
    for (let i = 0; i < limit; i++) {
      await loginFrom('203.0.113.7', `spray-${i}-${user.email}`, 'password123').expect(401);
    }
    const blocked = await loginFrom('203.0.113.7', user.email, 'password123').expect(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // Рахується останній запис x-forwarded-for — той, що додав найближчий proxy.
    await loginFrom('198.51.100.1, 203.0.113.7', user.email, 'password123').expect(429);
    await loginFrom('203.0.113.8', user.email, 'password123').expect(201);
  });

  it('успішні входи з одного IP не витрачають ліміт невдалих спроб', async () => {
    const limit = Number(process.env.LOGIN_IP_RATE_LIMIT);
    const users = await Promise.all(
      Array.from({ length: limit + 5 }, () => registerUser(app)),
    );
    for (const user of users) {
      await loginFrom('203.0.113.20', user.email, 'password123').expect(201);
    }
    for (let i = 0; i < limit; i++) {
      await loginFrom('203.0.113.20', `nat-${i}-${users[0].email}`, 'x').expect(401);
    }
    await loginFrom('203.0.113.20', users[1].email, 'password123').expect(429);
  });

  it('паралельні невдалі спроби з одного IP не перевищують ліміт', async () => {
    const limit = Number(process.env.LOGIN_IP_RATE_LIMIT);
    const user = await registerUser(app);
    const statuses = await Promise.all(
      Array.from({ length: limit * 2 }, (_, i) =>
        loginFrom('203.0.113.30', `burst-${i}-${user.email}`, 'password123').then(
          (res) => res.status,
        ),
      ),
    );
    expect(statuses.filter((status) => status === 401)).toHaveLength(limit);
    expect(statuses.filter((status) => status === 429)).toHaveLength(limit);
  });
});
