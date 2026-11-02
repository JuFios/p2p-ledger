import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from './helpers';

describe('Refresh rotation over HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app?.close();
  });
  it('allows a single winner for concurrent refresh requests', async () => {
    const first = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: `${randomUUID()}@example.com`, password: 'password123' })
      .expect(201);
    const results = await Promise.all(
      [0, 1].map(() =>
        request(app.getHttpServer())
          .post('/auth/refresh')
          .send({ refreshToken: first.body.refreshToken }),
      ),
    );
    expect(results.map((result) => result.status).sort()).toEqual([201, 401]);
    const winner = results.find((result) => result.status === 201)!;
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: winner.body.refreshToken })
      .expect(201);
  });
  it('revokes a rotated token and a token replaced by login', async () => {
    const credentials = {
      email: `${randomUUID()}@example.com`,
      password: 'password123',
    };
    const first = await request(app.getHttpServer())
      .post('/auth/register')
      .send(credentials)
      .expect(201);
    const rotated = await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(201);
    expect(rotated.body.refreshToken).not.toBe(first.body.refreshToken);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: first.body.refreshToken })
      .expect(401);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send(credentials)
      .expect(201);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
  });
});
