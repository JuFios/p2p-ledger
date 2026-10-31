import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { createWallet, deposit, getWallet, registerUser } from './helpers';

// Виклики внутрішнього API так, як їх робитиме payments-service.
export function internal(app: INestApplication) {
  const token = process.env.INTERNAL_API_TOKEN as string;
  const server = app.getHttpServer();
  return {
    get: (url: string) =>
      request(server).get(url).set('x-internal-token', token),
    post: (url: string, body: object) =>
      request(server).post(url).set('x-internal-token', token).send(body),
  };
}

export async function loginAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/auth/login')
    .send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    })
    .expect(201);
  return res.body.accessToken;
}

export interface Account {
  token: string;
  userId: string;
  walletId: string;
}

// Користувач з гаманцем у валюті currency і початковим поповненням.
export async function account(
  app: INestApplication,
  currency = 'USD',
  amount = 100,
): Promise<Account> {
  const { token } = await registerUser(app);
  const wallet = await createWallet(app, token, currency);
  if (amount > 0) {
    await deposit(app, token, wallet.id, amount).then((r) =>
      expect(r.status).toBe(201),
    );
  }
  const res = await getWallet(app, token, wallet.id);
  return { token, userId: res.body.ownerId, walletId: wallet.id };
}

export async function balanceOf(app: INestApplication, a: Account) {
  const res = await getWallet(app, a.token, a.walletId);
  const { balance, available, held } = res.body;
  return { balance, available, held };
}

export function placeHold(
  app: INestApplication,
  from: Account,
  amountMinor: string,
  overrides: Record<string, unknown> = {},
) {
  const transferId = randomUUID();
  const body = {
    operationId: `transfer:${transferId}:hold`,
    holdId: transferId,
    walletId: from.walletId,
    ownerId: from.userId,
    amountMinor,
    currency: 'USD',
    transferId,
    ...overrides,
  };
  return internal(app)
    .post('/internal/holds', body)
    .then((res) => ({ res, body, holdId: body.holdId as string }));
}

export function capture(
  app: INestApplication,
  holdId: string,
  to: Account,
  toAmountMinor: string,
  overrides: Record<string, unknown> = {},
) {
  return internal(app).post(`/internal/holds/${holdId}/capture`, {
    operationId: `transfer:${holdId}:capture`,
    toWalletId: to.walletId,
    toAmountMinor,
    toCurrency: 'USD',
    fxRate: 1,
    ...overrides,
  });
}

export function release(
  app: INestApplication,
  holdId: string,
  reason?: string,
  operationId = `transfer:${holdId}:release`,
  walletId?: string,
) {
  return internal(app).post(`/internal/holds/${holdId}/release`, {
    operationId,
    reason,
    walletId,
  });
}

export async function walletEvents(
  app: INestApplication,
  adminToken: string,
  walletId: string,
) {
  const res = await request(app.getHttpServer())
    .get(`/admin/wallets/${walletId}/events`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);
  return res.body as {
    eventId: string;
    globalPosition: string;
    type: string;
    payload: Record<string, unknown>;
  }[];
}

export async function freeze(
  app: INestApplication,
  adminToken: string,
  walletId: string,
) {
  return request(app.getHttpServer())
    .post(`/admin/wallets/${walletId}/freeze`)
    .set('Authorization', `Bearer ${adminToken}`);
}

export async function reconciliation(
  app: INestApplication,
  adminToken: string,
  query: Record<string, string> = {},
) {
  return request(app.getHttpServer())
    .get('/admin/reconciliation')
    .query(query)
    .set('Authorization', `Bearer ${adminToken}`);
}
