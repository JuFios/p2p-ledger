import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import request from 'supertest';
import { User } from '../../src/auth/entities/user.entity';
import { createApp } from './helpers';

describe('Concurrent registration', () => {
  let app: INestApplication;
  let users: Repository<User>;
  beforeAll(async () => {
    app = await createApp();
    users = app.get(getRepositoryToken(User));
  });
  afterAll(async () => { await app?.close(); });

  it('creates one account and returns conflicts to concurrent duplicates without invalidating its session', async () => {
    const credentials = { email: `${randomUUID()}@example.com`, password: 'password123' };
    const count = 10;
    let arrived = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const findOne = users.findOne.bind(users);
    const spy = jest.spyOn(users, 'findOne').mockImplementation(async options => {
      const result = await findOne(options);
      if (!result) {
        arrived++;
        if (arrived === count) release();
        await gate;
      }
      return result;
    });
    try {
      const responses = await Promise.all(Array.from({ length: count }, () =>
        request(app.getHttpServer()).post('/auth/register').send(credentials)));
      expect(arrived).toBe(count);
      expect(responses.filter(r => r.status === 201)).toHaveLength(1);
      expect(responses.filter(r => r.status === 409)).toHaveLength(count - 1);
      expect(await users.countBy({ email: credentials.email })).toBe(1);
      const winner = responses.find(r => r.status === 201)!;
      expect(winner.body.accessToken).toBeDefined();
      await request(app.getHttpServer()).post('/auth/refresh')
        .send({ refreshToken: winner.body.refreshToken }).expect(201);
      await request(app.getHttpServer()).post('/auth/login').send(credentials).expect(201);
    } finally {
      release();
      spy.mockRestore();
    }
  });
});
