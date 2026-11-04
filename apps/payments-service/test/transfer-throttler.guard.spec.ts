import { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import request from 'supertest';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { SplitBillsController } from '../src/split-bills/split-bills.controller';
import { SplitBillsService } from '../src/split-bills/split-bills.service';
import { TransferThrottlerGuard } from '../src/transfers/transfer-throttler.guard';
import { TransfersController } from '../src/transfers/transfers.controller';
import { TransfersService } from '../src/transfers/transfers.service';

describe('TransferThrottlerGuard', () => {
  it('ліміт рахується за userId з JWT, а не за IP', async () => {
    const guard = Object.create(TransferThrottlerGuard.prototype) as {
      getTracker(req: unknown): Promise<string>;
    };
    await expect(
      guard.getTracker({ user: { userId: 'user-1' }, ip: '10.0.0.5' }),
    ).resolves.toBe('user-1');
  });

  // Справжні контролери й guard'и, сервіси підмінено: перевіряється лише ліміт.
  describe('спільний ліміт переказу й оплати частки', () => {
    let app: INestApplication;
    const created = async () => ({ created: true, transfer: {} });

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [ThrottlerModule.forRoot([{ limit: 2, ttl: 60_000 }])],
        controllers: [TransfersController, SplitBillsController],
        providers: [
          { provide: TransfersService, useValue: { create: created } },
          { provide: SplitBillsService, useValue: { pay: created } },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: req.headers['x-user'] };
            return true;
          },
        })
        .compile();
      app = moduleRef.createNestApplication();
      await app.init();
    });

    afterAll(() => app.close());

    const id = '00000000-0000-4000-8000-000000000001';
    const transfer = (user: string) =>
      request(app.getHttpServer())
        .post('/transfers')
        .set('x-user', user)
        .set('Idempotency-Key', 'key')
        .send({});
    const pay = (user: string) =>
      request(app.getHttpServer())
        .post(`/split-bills/${id}/shares/${id}/pay`)
        .set('x-user', user)
        .set('Idempotency-Key', 'key')
        .send({});

    it('переказ і оплата частки витрачають один ліміт користувача', async () => {
      await transfer('user-1').expect(202);
      await pay('user-1').expect(202);
      await pay('user-1').expect(429);
      await transfer('user-1').expect(429);
      // Ліміт іншого користувача не зачеплено.
      await pay('user-2').expect(202);
    });
  });
});
