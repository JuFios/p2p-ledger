import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { createApp } from './helpers';

describe('Refresh revocation over HTTP', () => {
  let app: INestApplication;
  beforeAll(async () => { app = await createApp(); });
  afterAll(async () => { await app?.close(); });
  it('revokes refresh without a valid access token and keeps it revoked after login', async () => {
    const credentials = { email: `${randomUUID()}@example.com`, password: 'password123' };
    const first = await request(app.getHttpServer()).post('/auth/register').send(credentials).expect(201);
    await request(app.getHttpServer()).post('/auth/logout').set('Authorization', 'Bearer expired').send({ refreshToken: first.body.refreshToken }).expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    const current = await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(201);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: first.body.refreshToken }).expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: current.body.refreshToken }).expect(201);
  });
  it('ignores garbage tokens and leaves another user signed in', async () => {
    const other = await request(app.getHttpServer()).post('/auth/register').send({ email: `${randomUUID()}@example.com`, password: 'password123' }).expect(201);
    await request(app.getHttpServer()).post('/auth/logout').send({ refreshToken: 'garbage' }).expect(204);
    await request(app.getHttpServer()).post('/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(201);
  });
});
