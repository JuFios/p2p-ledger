import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { FakeLedger } from './fake-ledger';

export const FINAL = ['COMPLETED', 'FAILED'];

// Піднімає повний AppModule так само, як main.ts, проти реального Postgres
// і FakeLedger на LEDGER_SERVICE_URL.
export async function createApp(): Promise<{
  app: INestApplication;
  ledger: FakeLedger;
}> {
  const ledger = new FakeLedger(process.env.INTERNAL_API_TOKEN!);
  await ledger.start(Number(new URL(process.env.LEDGER_SERVICE_URL!).port));
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Один спільний сервер: без listen supertest піднімає окремий на кожен запит.
  await app.listen(0);
  return { app, ledger };
}

export async function closeApp(app: INestApplication, ledger: FakeLedger) {
  await app.close();
  await ledger.stop();
}

// Access-токен у форматі ledger-service (sub, email, role).
export function tokenFor(user: { userId: string; email: string }) {
  return new JwtService({ secret: process.env.JWT_ACCESS_SECRET }).sign(
    { sub: user.userId, email: user.email, role: 'user' },
    { expiresIn: '15m' },
  );
}

// Користувач у FakeLedger з гаманцем і токеном.
export function createUser(ledger: FakeLedger, currency = 'USD', balanceMinor = 0n) {
  const user = ledger.addUser();
  const wallet = ledger.addWallet(user.userId, currency, balanceMinor);
  return { ...user, wallet, token: tokenFor(user) };
}

export function postTransfer(
  app: INestApplication,
  token: string,
  body: Record<string, unknown>,
  idempotencyKey: string | null = randomUUID(),
) {
  const req = request(app.getHttpServer())
    .post('/transfers')
    .set('Authorization', `Bearer ${token}`);
  if (idempotencyKey !== null) req.set('Idempotency-Key', idempotencyKey);
  return req.send(body);
}

export async function waitForStatus(
  app: INestApplication,
  token: string,
  id: string,
  statuses = FINAL,
  timeoutMs = 10000,
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const res = await request(app.getHttpServer())
      .get(`/transfers/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    if (statuses.includes(res.body.status)) return res.body;
    if (Date.now() > deadline) {
      throw new Error(`Переказ ${id} у статусі ${res.body.status}/${res.body.step}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
