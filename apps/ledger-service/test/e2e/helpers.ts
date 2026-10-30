import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

// Піднімає повний AppModule так само, як main.ts, проти реального Postgres.
export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}

// Усі фікстури — через HTTP, щоб тести не залежали від внутрішньої моделі.
export async function registerUser(app: INestApplication) {
  const email = `${randomUUID()}@example.com`;
  const res = await request(app.getHttpServer())
    .post('/auth/register')
    .send({ email, password: 'password123' })
    .expect(201);
  return { email, token: res.body.accessToken as string };
}

export async function createWallet(
  app: INestApplication,
  token: string,
  currency = 'USD',
) {
  const res = await request(app.getHttpServer())
    .post('/wallets')
    .set('Authorization', `Bearer ${token}`)
    .send({ currency })
    .expect(201);
  return res.body as { id: string };
}

export async function deposit(
  app: INestApplication,
  token: string,
  walletId: string,
  amount: number,
) {
  return request(app.getHttpServer())
    .post(`/wallets/${walletId}/deposit`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount });
}

export async function withdraw(
  app: INestApplication,
  token: string,
  walletId: string,
  amount: number,
) {
  return request(app.getHttpServer())
    .post(`/wallets/${walletId}/withdraw`)
    .set('Authorization', `Bearer ${token}`)
    .send({ amount });
}

export async function getWallet(
  app: INestApplication,
  token: string,
  walletId: string,
) {
  return request(app.getHttpServer())
    .get(`/wallets/${walletId}`)
    .set('Authorization', `Bearer ${token}`);
}
