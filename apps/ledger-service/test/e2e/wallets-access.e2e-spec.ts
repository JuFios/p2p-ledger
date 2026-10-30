import { INestApplication } from '@nestjs/common';
import {
  createApp,
  createWallet,
  deposit,
  getWallet,
  registerUser,
  withdraw,
} from './helpers';

describe('Wallets access and input validation (e2e)', () => {
  let app: INestApplication;
  let tokenA: string;
  let tokenB: string;
  let walletA: string;
  let richWallet: string;

  beforeAll(async () => {
    app = await createApp();
    tokenA = (await registerUser(app)).token;
    tokenB = (await registerUser(app)).token;
    walletA = (await createWallet(app, tokenA)).id;
    await deposit(app, tokenA, walletA, 100);

    // Понад 1_000_001, щоб «недостатньо коштів» не маскувало перевірку @Max.
    richWallet = (await createWallet(app, tokenB, 'EUR')).id;
    await deposit(app, tokenB, richWallet, 1_000_000);
    await deposit(app, tokenB, richWallet, 1_000_000);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('B2: чужий гаманець недоступний', () => {
    it('GET чужого гаманця → 404', async () => {
      const res = await getWallet(app, tokenB, walletA);
      expect(res.status).toBe(404);
    });

    it('deposit на чужий гаманець → 404', async () => {
      const res = await deposit(app, tokenB, walletA, 10);
      expect(res.status).toBe(404);
    });

    it('withdraw з чужого гаманця → 404, баланс власника не змінився', async () => {
      const res = await withdraw(app, tokenB, walletA, 10);
      expect(res.status).toBe(404);

      const own = await getWallet(app, tokenA, walletA);
      expect(own.body.balance).toBe('100.00');
    });
  });

  describe('B3: валідація вхідних даних', () => {
    it.each(['get', 'deposit', 'withdraw'])(
      '%s з id, що не є UUID → 400',
      async (op) => {
        const res =
          op === 'get'
            ? await getWallet(app, tokenA, 'abc')
            : op === 'deposit'
              ? await deposit(app, tokenA, 'abc', 10)
              : await withdraw(app, tokenA, 'abc', 10);
        expect(res.status).toBe(400);
      },
    );

    it.each([0.001, 10.999, 1e20, 1_000_001, 1e-7, 5e-324, -1e-7])(
      'deposit з amount=%s → 400',
      async (amount) => {
        const res = await deposit(app, tokenA, walletA, amount);
        expect(res.status).toBe(400);
      },
    );

    it.each([0.001, 1_000_001, 1e20, 1e-7, 5e-324, -1e-7])(
      'withdraw з amount=%s → 400 навіть коли коштів достатньо',
      async (amount) => {
        const res = await withdraw(app, tokenB, richWallet, amount);
        expect(res.status).toBe(400);
        expect(res.body.message).toEqual(
          expect.arrayContaining([expect.stringContaining('amount must be')]),
        );
      },
    );

    it('після відхилених запитів баланс не змінився', async () => {
      const res = await getWallet(app, tokenA, walletA);
      expect(res.body.balance).toBe('100.00');
    });
  });
});
