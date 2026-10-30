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

  it('deposit does not touch other wallets', async () => {
    const a = await registerUser(app);
    const b = await registerUser(app);
    const walletA = await createWallet(app, a.token);
    const walletB = await createWallet(app, b.token);

    await deposit(app, a.token, walletA.id, 50);

    expect((await getWallet(app, a.token, walletA.id)).body.balance).toBe(
      '50.00',
    );
    expect((await getWallet(app, b.token, walletB.id)).body.balance).toBe(
      '0.00',
    );
  });

  it('allows withdrawing exactly the whole balance but not one cent more', async () => {
    const { token } = await registerUser(app);
    const wallet = await createWallet(app, token);
    await deposit(app, token, wallet.id, 10.1);

    expect((await withdraw(app, token, wallet.id, 10.11)).status).toBe(400);
    expect((await withdraw(app, token, wallet.id, 10.1)).status).toBe(201);
    expect((await getWallet(app, token, wallet.id)).body.balance).toBe('0.00');
  });
});
