import { HttpService } from '@nestjs/axios';
import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AxiosError, AxiosHeaders } from 'axios';
import { of, throwError } from 'rxjs';
import { LedgerClient } from '../src/ledger/ledger.client';
import {
  classifyLedgerError,
  LedgerRejection,
  LedgerUnavailable,
} from '../src/ledger/ledger-errors';
import { decide } from '../src/saga/transfer-saga';
import { Transfer } from '../src/transfers/entities/transfer.entity';

function httpError(status?: number, data?: unknown) {
  const error = new AxiosError('request failed');
  if (status !== undefined) {
    error.response = {
      status,
      data,
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
    };
  }
  return error;
}

describe('classifyLedgerError', () => {
  it('4xx з кодом — остаточна відмова', () => {
    const error = classifyLedgerError(
      httpError(409, { code: 'INSUFFICIENT_FUNDS', message: 'Недостатньо коштів' }),
    );
    expect(error).toBeInstanceOf(LedgerRejection);
    expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_FUNDS' });
  });

  it.each([
    ['5xx', httpError(503)],
    ['мережа/таймаут', httpError()],
    ['401 (міжсервісний токен)', httpError(401)],
    ['429', httpError(429)],
  ])('%s — невизначений результат', (_name, raw) => {
    expect(classifyLedgerError(raw)).toBeInstanceOf(LedgerUnavailable);
  });
});

describe('LedgerClient: circuit breaker', () => {
  const config = new ConfigService({
    CB_TIMEOUT_MS: 1000,
    CB_ERROR_THRESHOLD_PERCENT: 50,
    CB_RESET_TIMEOUT_MS: 60000,
  });

  it('після збоїв breaker відкривається: ledger більше не викликається, сага — AWAITING_RETRY', async () => {
    const http = { request: jest.fn(() => throwError(() => httpError(503))) };
    const client = new LedgerClient(http as unknown as HttpService, config);
    try {
      await expect(client.getHold('h')).rejects.toBeInstanceOf(LedgerUnavailable);
      const calls = http.request.mock.calls.length;

      const opened = client.getHold('h');
      await expect(opened).rejects.toBeInstanceOf(LedgerUnavailable);
      await expect(opened).rejects.toThrow(/Breaker is open/);
      expect(http.request).toHaveBeenCalledTimes(calls);

      const transfer = Object.assign(new Transfer(), {
        status: 'PROCESSING',
        step: 'HOLD',
        attempts: 0,
        failureReason: null,
      });
      const transition = decide(
        transfer,
        { type: 'uncertain', error: 'Breaker is open' },
        new Date(),
        { maxAttempts: 5, retryBaseMs: 100 },
      );
      expect(transition.status).toBe('AWAITING_RETRY');
    } finally {
      client.onApplicationShutdown();
    }
  });

  it('остаточні відмови ledger не відкривають breaker', async () => {
    const http = {
      request: jest.fn(() =>
        throwError(() => httpError(409, { code: 'INSUFFICIENT_FUNDS' })),
      ),
    };
    const client = new LedgerClient(http as unknown as HttpService, config);
    try {
      for (let i = 0; i < 5; i++) {
        await expect(client.getHold('h')).rejects.toBeInstanceOf(LedgerRejection);
      }
      expect(http.request).toHaveBeenCalledTimes(5);
    } finally {
      client.onApplicationShutdown();
    }
  });
});

describe('LedgerClient: зупинка застосунку', () => {
  // Nest викликає onModuleDestroy раніше за beforeApplicationShutdown, де
  // saga runner дочікується кроків, що виконуються: ledger має лишатись
  // доступним, поки вони не закінчились.
  it('breaker працює, поки runner дочікується поточних кроків', async () => {
    const http = {
      request: jest.fn(() => of({ data: { holdId: 'h', status: 'ACTIVE' } })),
    };
    let duringShutdown: unknown;

    @Injectable()
    class Runner implements BeforeApplicationShutdown {
      constructor(private readonly ledger: LedgerClient) {}
      async beforeApplicationShutdown() {
        duringShutdown = await this.ledger.getHold('h').catch((error) => error);
      }
    }

    const moduleRef = await Test.createTestingModule({
      providers: [
        LedgerClient,
        Runner,
        { provide: HttpService, useValue: http },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            CB_TIMEOUT_MS: 1000,
            CB_ERROR_THRESHOLD_PERCENT: 50,
            CB_RESET_TIMEOUT_MS: 60000,
          }),
        },
      ],
    }).compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    await app.close();

    expect(duringShutdown).toEqual({ holdId: 'h', status: 'ACTIVE' });
  });
});
