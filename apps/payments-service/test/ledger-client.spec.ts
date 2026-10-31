import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosHeaders } from 'axios';
import { throwError } from 'rxjs';
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
      client.onModuleDestroy();
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
      client.onModuleDestroy();
    }
  });
});
