import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createApp,
  createWallet,
  deposit,
  getWallet,
  registerUser,
  withdraw,
} from './helpers';

describe('Wallets (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('creates a wallet, deposits and withdraws', async () => {
    const { token } = await registerUser(app);
    const wallet = await createWallet(app, token);

    await deposit(app, token, wallet.id, 100).then((r) =>
      expect(r.status).toBe(201),
    );
    const res = await withdraw(app, token, wallet.id, 30.5);
    expect(res.status).toBe(201);

    const fetched = await getWallet(app, token, wallet.id);
    expect(fetched.status).toBe(200);
    expect(fetched.body.balance).toBe('69.50');
  });

  it('returns the existing wallet on repeated POST /wallets', async () => {
    const { token } = await registerUser(app);
    const first = await createWallet(app, token);
    const second = await createWallet(app, token);
    expect(second.id).toBe(first.id);
  });

  it('rejects an unsupported currency', async () => {
    const { token } = await registerUser(app);
    await request(app.getHttpServer())
      .post('/wallets')
      .set('Authorization', `Bearer ${token}`)
      .send({ currency: 'XXX' })
      .expect(400);
  });
});
