import { ConfigService } from '@nestjs/config';
import { FxService } from '../src/fx/fx.service';
import { LedgerClient } from '../src/ledger/ledger.client';
import {
  LedgerRejection,
  LedgerUnavailable,
} from '../src/ledger/ledger-errors';
import { decide, TransferSaga } from '../src/saga/transfer-saga';
import { Transfer } from '../src/transfers/entities/transfer.entity';

const SENDER = '00000000-0000-4000-8000-000000000001';
const RECIPIENT = '00000000-0000-4000-8000-000000000002';
const TO_WALLET = '00000000-0000-4000-8000-0000000000aa';

const env = {
  TRANSFER_MAX_AMOUNT: 10000,
  BLOCKED_EMAILS: 'blocked@example.com',
  FX_RATES_JSON: '{"USD":1,"EUR":0.92,"UAH":41.5}',
  FX_CACHE_TTL_MS: 30000,
  FX_MAX_QUOTE_AGE_MS: 60000,
  SAGA_MAX_ATTEMPTS: 3,
  SAGA_RETRY_BASE_MS: 100,
};

function newTransfer(overrides: Partial<Transfer> = {}): Transfer {
  return Object.assign(new Transfer(), {
    id: '00000000-0000-4000-8000-0000000000ff',
    senderUserId: SENDER,
    senderEmail: 'sender@example.com',
    fromWalletId: '00000000-0000-4000-8000-0000000000bb',
    recipientEmail: 'recipient@example.com',
    recipientUserId: null,
    toWalletId: null,
    amountMinor: '1000',
    currency: 'USD',
    toAmountMinor: null,
    toCurrency: 'USD',
    fxRate: null,
    fxQuotedAt: null,
    status: 'PENDING',
    step: 'RISK_CHECK',
    attempts: 0,
    nextAttemptAt: new Date(),
    failureReason: null,
    ...overrides,
  });
}

// Мок ledger: усі кроки успішні, окремі методи перевизначаються в тесті.
function ledgerMock() {
  return {
    findUserByEmail: jest.fn(async () => ({
      userId: RECIPIENT,
      email: 'recipient@example.com',
    })),
    ensureWallet: jest.fn(async () => ({
      walletId: TO_WALLET,
      ownerId: RECIPIENT,
      currency: 'USD',
      frozen: false,
    })),
    getWallet: jest.fn(async () => ({
      walletId: TO_WALLET,
      ownerId: RECIPIENT,
      currency: 'USD',
      frozen: false,
      available: '0.00',
      held: '0.00',
    })),
    placeHold: jest.fn(async () => ({ holdId: 'h', status: 'ACTIVE' })),
    captureHold: jest.fn(async () => ({ holdId: 'h', status: 'CAPTURED' })),
    releaseHold: jest.fn(async () => ({ holdId: 'h', status: 'RELEASED' })),
    getHold: jest.fn(async () => ({ holdId: 'h', status: 'ACTIVE' })),
  };
}

type LedgerMock = ReturnType<typeof ledgerMock>;

function createSaga(ledger: LedgerMock) {
  const config = new ConfigService(env);
  return new TransferSaga(
    ledger as unknown as LedgerClient,
    new FxService(config),
    config,
  );
}

// Проганяє сагу так само, як runner: крок → decide → наступний крок; на
// ретраях «чекає» до next_attempt_at. Повертає фінальний стан переказу.
async function runSaga(saga: TransferSaga, transfer: Transfer, maxSteps = 50) {
  let current = transfer;
  for (let i = 0; i < maxSteps; i++) {
    if (current.status === 'COMPLETED' || current.status === 'FAILED') {
      return current;
    }
    const now = current.nextAttemptAt;
    const result = await saga.execute(current, now);
    const t = decide(current, result, now, saga.settings);
    current = Object.assign(new Transfer(), current, t.patch, {
      status: t.status,
      step: t.step,
      attempts: t.attempts,
      nextAttemptAt: t.nextAttemptAt,
      failureReason: t.failureReason,
    });
  }
  return current;
}

const rejection = (code: string, status = 409) =>
  new LedgerRejection(status, code, code);
const unavailable = () => new LedgerUnavailable('ledger відповів 503');

describe('TransferSaga', () => {
  it('успішний переказ: холд → capture, без release', async () => {
    const ledger = ledgerMock();
    const result = await runSaga(createSaga(ledger), newTransfer());
    expect(result).toMatchObject({
      status: 'COMPLETED',
      step: 'DONE',
      recipientUserId: RECIPIENT,
      toWalletId: TO_WALLET,
      toAmountMinor: '1000',
      failureReason: null,
    });
    expect(ledger.placeHold).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: `transfer:${result.id}:hold`,
        holdId: result.id,
        ownerId: SENDER,
        amountMinor: '1000',
      }),
    );
    expect(ledger.captureHold).toHaveBeenCalledWith(
      result.id,
      expect.objectContaining({
        operationId: `transfer:${result.id}:capture`,
        toAmountMinor: '1000',
        fxRate: 1,
      }),
    );
    expect(ledger.releaseHold).not.toHaveBeenCalled();
  });

  it('міжвалютний переказ: сума зарахування за курсом, округлена вниз', async () => {
    const ledger = ledgerMock();
    const result = await runSaga(
      createSaga(ledger),
      newTransfer({ amountMinor: '1001', toCurrency: 'EUR' }),
    );
    // 10.01 USD × 0.92 = 9.2092 EUR → 9.20
    expect(result).toMatchObject({
      status: 'COMPLETED',
      fxRate: '0.92000000',
      toAmountMinor: '920',
    });
    expect(ledger.ensureWallet).toHaveBeenCalledWith(RECIPIENT, 'EUR');
  });

  describe('відмова на кроці до холду → FAILED, компенсувати нічого', () => {
    it.each([
      ['RISK_CHECK: ліміт суми', { amountMinor: '1000001' }, 'LIMIT_EXCEEDED'],
      [
        'RISK_CHECK: чорний список',
        { recipientEmail: 'Blocked@example.com' },
        'BLOCKED',
      ],
    ])('%s', async (_name, overrides, reason) => {
      const ledger = ledgerMock();
      const result = await runSaga(createSaga(ledger), newTransfer(overrides));
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'RISK_CHECK',
        failureReason: reason,
      });
      expect(ledger.findUserByEmail).not.toHaveBeenCalled();
      expect(ledger.placeHold).not.toHaveBeenCalled();
      expect(ledger.releaseHold).not.toHaveBeenCalled();
    });

    it('RESOLVE_RECIPIENT: отримувача немає', async () => {
      const ledger = ledgerMock();
      ledger.findUserByEmail.mockRejectedValue(rejection('NOT_FOUND', 404));
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'RESOLVE_RECIPIENT',
        failureReason: 'RECIPIENT_NOT_FOUND',
      });
      expect(ledger.placeHold).not.toHaveBeenCalled();
      expect(ledger.releaseHold).not.toHaveBeenCalled();
    });

    it('RESOLVE_RECIPIENT: отримувач — сам відправник (за userId) → SELF_TRANSFER', async () => {
      const ledger = ledgerMock();
      ledger.findUserByEmail.mockResolvedValue({
        userId: SENDER,
        email: 'sender@example.com',
      });
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        failureReason: 'SELF_TRANSFER',
      });
      expect(ledger.placeHold).not.toHaveBeenCalled();
    });

    it('email відрізняється лише регістром, а акаунт інший (ledger розрізняє регістр) → переказ іде далі', async () => {
      const ledger = ledgerMock();
      // Відправник — sender@example.com; Sender@example.com у ledger — інший користувач.
      const result = await runSaga(
        createSaga(ledger),
        newTransfer({ recipientEmail: 'Sender@example.com' }),
      );
      expect(result).toMatchObject({ status: 'COMPLETED' });
      expect(ledger.findUserByEmail).toHaveBeenCalledWith('Sender@example.com');
      expect(ledger.captureHold).toHaveBeenCalledTimes(1);
    });

    it('FX_QUOTE: сума після конвертації менша за мінорну одиницю', async () => {
      const ledger = ledgerMock();
      const result = await runSaga(
        createSaga(ledger),
        newTransfer({ amountMinor: '1', currency: 'UAH', toCurrency: 'USD' }),
      );
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'FX_QUOTE',
        failureReason: 'AMOUNT_TOO_SMALL',
      });
      expect(ledger.placeHold).not.toHaveBeenCalled();
    });

    it.each(['INSUFFICIENT_FUNDS', 'OWNER_MISMATCH', 'WALLET_FROZEN'])(
      'HOLD: ledger відмовив (%s) — холду немає',
      async (code) => {
        const ledger = ledgerMock();
        ledger.placeHold.mockRejectedValue(rejection(code));
        const result = await runSaga(createSaga(ledger), newTransfer());
        expect(result).toMatchObject({
          status: 'FAILED',
          step: 'HOLD',
          failureReason: code,
        });
        expect(ledger.captureHold).not.toHaveBeenCalled();
        expect(ledger.releaseHold).not.toHaveBeenCalled();
      },
    );
  });

  describe('відмова після холду → компенсація (release) → FAILED', () => {
    it('CONFIRM: отримувач заморожений', async () => {
      const ledger = ledgerMock();
      ledger.getWallet.mockResolvedValue({
        walletId: TO_WALLET,
        ownerId: RECIPIENT,
        currency: 'USD',
        frozen: true,
        available: '0.00',
        held: '0.00',
      });
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'RELEASE_HOLD',
        failureReason: 'RECIPIENT_FROZEN',
      });
      expect(ledger.captureHold).not.toHaveBeenCalled();
      expect(ledger.releaseHold).toHaveBeenCalledTimes(1);
      expect(ledger.releaseHold).toHaveBeenCalledWith(
        result.id,
        `transfer:${result.id}:release`,
        'RECIPIENT_FROZEN',
        result.fromWalletId,
      );
    });

    it('CONFIRM: курс застарів', async () => {
      const ledger = ledgerMock();
      const quotedAt = new Date(Date.now() - 120_000);
      const result = await runSaga(
        createSaga(ledger),
        newTransfer({
          status: 'PROCESSING',
          step: 'CONFIRM',
          currency: 'USD',
          toCurrency: 'EUR',
          toWalletId: TO_WALLET,
          fxRate: '0.92000000',
          fxQuotedAt: quotedAt,
          toAmountMinor: '920',
        }),
      );
      expect(result).toMatchObject({
        status: 'FAILED',
        failureReason: 'FX_QUOTE_EXPIRED',
      });
      expect(ledger.getWallet).not.toHaveBeenCalled();
      expect(ledger.captureHold).not.toHaveBeenCalled();
      expect(ledger.releaseHold).toHaveBeenCalledTimes(1);
    });

    it('CAPTURE: ledger відмовив (отримувача заморозили після CONFIRM)', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(rejection('RECIPIENT_FROZEN'));
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'RELEASE_HOLD',
        failureReason: 'RECIPIENT_FROZEN',
      });
      expect(ledger.captureHold).toHaveBeenCalledTimes(1);
      expect(ledger.releaseHold).toHaveBeenCalledTimes(1);
    });

    it('компенсація повторюється, поки ledger недоступний, і не кидається', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(rejection('RECIPIENT_FROZEN'));
      ledger.releaseHold
        .mockRejectedValueOnce(unavailable())
        .mockRejectedValueOnce(unavailable())
        .mockRejectedValueOnce(unavailable())
        .mockRejectedValueOnce(unavailable());
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        failureReason: 'RECIPIENT_FROZEN',
      });
      // Більше за SAGA_MAX_ATTEMPTS: компенсацію не обмежено спробами.
      expect(ledger.releaseHold).toHaveBeenCalledTimes(5);
    });

    it('release: холд уже захоплено → COMPLETED, а не FAILED', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(rejection('RECIPIENT_FROZEN'));
      ledger.releaseHold.mockRejectedValue(rejection('HOLD_NOT_ACTIVE'));
      ledger.getHold.mockResolvedValue({ holdId: 'h', status: 'CAPTURED' });
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result.status).toBe('COMPLETED');
    });
  });

  describe('невизначений результат (5xx, таймаут, breaker open)', () => {
    it('ретрай з backoff, AWAITING_RETRY, а не FAILED', async () => {
      const ledger = ledgerMock();
      ledger.placeHold.mockRejectedValue(unavailable());
      const saga = createSaga(ledger);
      const transfer = newTransfer({ status: 'PROCESSING', step: 'HOLD' });
      const now = new Date();
      const t = decide(transfer, await saga.execute(transfer, now), now, saga.settings);
      expect(t).toMatchObject({
        status: 'AWAITING_RETRY',
        step: 'HOLD',
        attempts: 1,
        continue: false,
      });
      expect(t.nextAttemptAt.getTime() - now.getTime()).toBe(200);
    });

    it('HOLD: спроби вичерпано → release (холд міг з’явитись) → FAILED', async () => {
      const ledger = ledgerMock();
      ledger.placeHold.mockRejectedValue(unavailable());
      ledger.releaseHold.mockRejectedValue(rejection('NOT_FOUND', 404));
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        failureReason: 'RETRIES_EXHAUSTED',
      });
      expect(ledger.placeHold).toHaveBeenCalledTimes(3);
      expect(ledger.releaseHold).toHaveBeenCalledTimes(1);
      // Гаманець потрібен ledger, щоб зняти холд, який ще не з'явився.
      expect(ledger.releaseHold).toHaveBeenCalledWith(
        result.id,
        `transfer:${result.id}:release`,
        'RETRIES_EXHAUSTED',
        result.fromWalletId,
      );
    });

    it('RESOLVE_RECIPIENT: спроби вичерпано → FAILED без release', async () => {
      const ledger = ledgerMock();
      ledger.findUserByEmail.mockRejectedValue(unavailable());
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        step: 'RESOLVE_RECIPIENT',
        failureReason: 'RETRIES_EXHAUSTED',
      });
      expect(ledger.findUserByEmail).toHaveBeenCalledTimes(3);
      expect(ledger.releaseHold).not.toHaveBeenCalled();
    });

    it('CAPTURE: невідомий результат ніколи не веде до release', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(unavailable());
      ledger.getHold.mockRejectedValue(unavailable());
      const result = await runSaga(createSaga(ledger), newTransfer(), 30);
      expect(result).toMatchObject({
        status: 'AWAITING_RETRY',
        step: 'CAPTURE',
      });
      expect(ledger.releaseHold).not.toHaveBeenCalled();
      // Після SAGA_MAX_ATTEMPTS capture не повторюється наосліп — з'ясовуємо стан холду.
      expect(ledger.captureHold).toHaveBeenCalledTimes(3);
    });

    it('CAPTURE: спроби вичерпано, холд CAPTURED → COMPLETED без release', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(unavailable());
      ledger.getHold.mockResolvedValue({ holdId: 'h', status: 'CAPTURED' });
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result.status).toBe('COMPLETED');
      expect(ledger.releaseHold).not.toHaveBeenCalled();
    });

    it('CAPTURE: спроби вичерпано, холд ACTIVE → release → FAILED', async () => {
      const ledger = ledgerMock();
      ledger.captureHold.mockRejectedValue(unavailable());
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result).toMatchObject({
        status: 'FAILED',
        failureReason: 'CAPTURE_UNCONFIRMED',
      });
      expect(ledger.releaseHold).toHaveBeenCalledTimes(1);
    });

    it('після збою сага продовжується з того самого кроку з тим самим operationId', async () => {
      const ledger = ledgerMock();
      ledger.placeHold.mockRejectedValueOnce(unavailable());
      const result = await runSaga(createSaga(ledger), newTransfer());
      expect(result.status).toBe('COMPLETED');
      const operationIds = ledger.placeHold.mock.calls.map(
        (call: unknown[]) => (call[0] as { operationId: string }).operationId,
      );
      expect(operationIds).toEqual([
        `transfer:${result.id}:hold`,
        `transfer:${result.id}:hold`,
      ]);
    });
  });
});
