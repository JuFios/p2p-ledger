import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { blockedEmails } from '../common/blocked-emails';
import { toMinor } from '../common/money';
import { convertMinor, FxService } from '../fx/fx.service';
import { LedgerClient } from '../ledger/ledger.client';
import { LedgerRejection } from '../ledger/ledger-errors';
import {
  Transfer,
  TransferStatus,
  TransferStep,
} from '../transfers/entities/transfer.entity';

// Результат одного кроку саги.
export type StepResult =
  | { type: 'next'; patch?: Partial<Transfer> } // крок виконано
  | { type: 'completed' } // гроші зараховано отримувачу
  | { type: 'rejected'; reason: string } // остаточна відмова кроку
  | { type: 'compensated' } // холд знято (або його не було)
  | { type: 'uncertain'; error: string }; // результат невідомий → ретрай

export interface SagaSettings {
  maxAttempts: number;
  retryBaseMs: number;
}

// Новий стан переказу після кроку. continue — виконувати наступний крок
// одразу, не чекаючи наступного тіку runner'а.
export interface Transition {
  status: TransferStatus;
  step: TransferStep;
  attempts: number;
  nextAttemptAt: Date;
  failureReason: string | null;
  patch: Partial<Transfer>;
  continue: boolean;
}

const NEXT_STEP: Partial<Record<TransferStep, TransferStep>> = {
  RISK_CHECK: 'RESOLVE_RECIPIENT',
  RESOLVE_RECIPIENT: 'FX_QUOTE',
  FX_QUOTE: 'HOLD',
  HOLD: 'CONFIRM',
  CONFIRM: 'CAPTURE',
};

const MAX_BACKOFF_MS = 60_000;

export function backoffMs(attempts: number, baseMs: number): number {
  return Math.min(baseMs * 2 ** attempts, MAX_BACKOFF_MS);
}

// Таблиця переходів саги (див. README «Сага переказу»):
// - відмова до холду → FAILED, компенсувати нічого (крім відмови HOLD після
//   спроби без відповіді — тоді release, бо запізнілий холд ще можливий);
// - відмова після холду (CONFIRM, CAPTURE) → COMPENSATING → RELEASE_HOLD;
// - невизначений результат → ретрай з backoff; вичерпані спроби — як відмова,
//   крім CAPTURE (його результат з'ясовується в самому кроці через стан
//   холду) і RELEASE_HOLD (компенсація повторюється, доки не пройде).
export function decide(
  transfer: Transfer,
  result: StepResult,
  now: Date,
  settings: SagaSettings,
): Transition {
  const base = {
    attempts: 0,
    nextAttemptAt: now,
    failureReason: transfer.failureReason,
    patch: {},
  };
  const compensate = (reason: string): Transition => ({
    ...base,
    status: 'COMPENSATING',
    step: 'RELEASE_HOLD',
    failureReason: reason,
    continue: true,
  });
  const fail = (reason: string): Transition => ({
    ...base,
    status: 'FAILED',
    step: transfer.step,
    failureReason: reason,
    continue: false,
  });
  const holdAlreadyPlaced =
    transfer.step === 'CONFIRM' || transfer.step === 'CAPTURE';

  const holdMayHaveBeenPlaced = transfer.step === 'HOLD' || holdAlreadyPlaced;
  // Попередня спроба HOLD лишилась без відповіді й може ще виконатись у
  // ledger. Відмову ledger не запам'ятовує, тож без release запізнілий place
  // створив би холд уже після FAILED; release за гаманцем лишає слід зняття.
  const holdMayStillLand = transfer.step === 'HOLD' && transfer.attempts > 0;
  const mustResolveOutcome =
    transfer.step === 'CAPTURE' || transfer.step === 'RELEASE_HOLD';

  switch (result.type) {
    case 'next': {
      const step = NEXT_STEP[transfer.step];
      if (!step) {
        throw new Error(`Після кроку ${transfer.step} наступного немає`);
      }
      return {
        ...base,
        status: 'PROCESSING',
        step,
        patch: result.patch ?? {},
        continue: true,
      };
    }
    case 'completed':
      return {
        ...base,
        status: 'COMPLETED',
        step: 'DONE',
        failureReason: null,
        continue: false,
      };
    case 'compensated':
      return { ...base, status: 'FAILED', step: transfer.step, continue: false };
    case 'rejected':
      return holdAlreadyPlaced || holdMayStillLand
        ? compensate(result.reason)
        : fail(result.reason);
    case 'uncertain': {
      const attempts = transfer.attempts + 1;
      if (!mustResolveOutcome && attempts >= settings.maxAttempts) {
        // Відповіді на HOLD так і не отримали — холд міг з'явитись, тож
        // знімаємо його (release неіснуючого холду поверне NOT_FOUND).
        return holdMayHaveBeenPlaced
          ? compensate('RETRIES_EXHAUSTED')
          : fail('RETRIES_EXHAUSTED');
      }
      return {
        ...base,
        status:
          transfer.status === 'COMPENSATING' ? 'COMPENSATING' : 'AWAITING_RETRY',
        step: transfer.step,
        attempts,
        nextAttemptAt: new Date(
          now.getTime() + backoffMs(attempts, settings.retryBaseMs),
        ),
        continue: false,
      };
    }
  }
}

// Виконання кроків саги переказу. Кожен виклик ledger ідемпотентний за
// operationId transfer:<id>:<крок>, тож повтор кроку безпечний.
@Injectable()
export class TransferSaga {
  private readonly logger = new Logger(TransferSaga.name);

  constructor(
    private readonly ledger: LedgerClient,
    private readonly fx: FxService,
    private readonly config: ConfigService,
  ) {}

  get settings(): SagaSettings {
    return {
      maxAttempts: this.config.getOrThrow<number>('SAGA_MAX_ATTEMPTS'),
      retryBaseMs: this.config.getOrThrow<number>('SAGA_RETRY_BASE_MS'),
    };
  }

  async execute(transfer: Transfer, now = new Date()): Promise<StepResult> {
    try {
      return await this.run(transfer, now);
    } catch (error) {
      // Відмова під час компенсації — не привід кинути холд: повторюємо.
      if (error instanceof LedgerRejection && transfer.step !== 'RELEASE_HOLD') {
        return { type: 'rejected', reason: error.code };
      }
      // LedgerUnavailable або непередбачена помилка: стан у ledger невідомий.
      this.logger.warn(
        `Переказ ${transfer.id}, крок ${transfer.step}: ${(error as Error).message}`,
      );
      return { type: 'uncertain', error: (error as Error).message };
    }
  }

  private async run(transfer: Transfer, now: Date): Promise<StepResult> {
    switch (transfer.step) {
      case 'RISK_CHECK':
        return this.riskCheck(transfer);
      case 'RESOLVE_RECIPIENT':
        return this.resolveRecipient(transfer);
      case 'FX_QUOTE':
        return this.fxQuote(transfer, now);
      case 'HOLD':
        await this.ledger.placeHold({
          operationId: `transfer:${transfer.id}:hold`,
          holdId: transfer.id,
          walletId: transfer.fromWalletId,
          ownerId: transfer.senderUserId,
          amountMinor: transfer.amountMinor,
          currency: transfer.currency,
          transferId: transfer.id,
        });
        return { type: 'next' };
      case 'CONFIRM':
        return this.confirm(transfer, now);
      case 'CAPTURE':
        return this.capture(transfer);
      case 'RELEASE_HOLD':
        return this.releaseHold(transfer);
      case 'DONE':
        throw new Error('Сагу вже завершено');
    }
  }

  // Мок-правила: ліміт суми, чорний список. Переказ самому собі відхиляє
  // RESOLVE_RECIPIENT за userId: ledger розрізняє email за регістром, тож
  // порівняння рядків відхилило б переказ між двома різними акаунтами.
  private riskCheck(transfer: Transfer): StepResult {
    const max = toMinor(this.config.getOrThrow<number>('TRANSFER_MAX_AMOUNT'));
    if (BigInt(transfer.amountMinor) > max) {
      return { type: 'rejected', reason: 'LIMIT_EXCEEDED' };
    }
    const blocked = blockedEmails(this.config);
    const sender = transfer.senderEmail.toLowerCase();
    const recipient = transfer.recipientEmail.toLowerCase();
    if (blocked.has(sender) || blocked.has(recipient)) {
      return { type: 'rejected', reason: 'BLOCKED' };
    }
    return { type: 'next' };
  }

  // Frozen отримувача тут не перевіряється — це робить CONFIRM після холду.
  private async resolveRecipient(transfer: Transfer): Promise<StepResult> {
    let user;
    try {
      user = await this.ledger.findUserByEmail(transfer.recipientEmail);
    } catch (error) {
      if (error instanceof LedgerRejection && error.code === 'NOT_FOUND') {
        return { type: 'rejected', reason: 'RECIPIENT_NOT_FOUND' };
      }
      throw error;
    }
    if (user.userId === transfer.senderUserId) {
      return { type: 'rejected', reason: 'SELF_TRANSFER' };
    }
    const wallet = await this.ledger.ensureWallet(
      user.userId,
      transfer.toCurrency,
    );
    return {
      type: 'next',
      patch: { recipientUserId: user.userId, toWalletId: wallet.walletId },
    };
  }

  private fxQuote(transfer: Transfer, now: Date): StepResult {
    if (transfer.currency === transfer.toCurrency) {
      return {
        type: 'next',
        patch: {
          fxRate: '1.00000000',
          fxQuotedAt: null,
          toAmountMinor: transfer.amountMinor,
        },
      };
    }
    const quote = this.fx.quote(transfer.currency, transfer.toCurrency, now);
    const toAmountMinor = convertMinor(BigInt(transfer.amountMinor), quote.rate);
    if (toAmountMinor === 0n) {
      return { type: 'rejected', reason: 'AMOUNT_TOO_SMALL' };
    }
    return {
      type: 'next',
      patch: {
        fxRate: quote.rate,
        fxQuotedAt: quote.quotedAt,
        toAmountMinor: toAmountMinor.toString(),
      },
    };
  }

  private async confirm(transfer: Transfer, now: Date): Promise<StepResult> {
    const maxAge = this.config.getOrThrow<number>('FX_MAX_QUOTE_AGE_MS');
    if (
      transfer.fxQuotedAt &&
      now.getTime() - transfer.fxQuotedAt.getTime() > maxAge
    ) {
      return { type: 'rejected', reason: 'FX_QUOTE_EXPIRED' };
    }
    const recipient = await this.ledger.getWallet(transfer.toWalletId!);
    if (recipient.frozen) {
      return { type: 'rejected', reason: 'RECIPIENT_FROZEN' };
    }
    return { type: 'next' };
  }

  // Поки результат capture невідомий, холд не знімаємо: гроші могли вже
  // зарахуватись. Після SAGA_MAX_ATTEMPTS з'ясовуємо це за станом холду.
  private async capture(transfer: Transfer): Promise<StepResult> {
    if (transfer.attempts >= this.settings.maxAttempts) {
      const hold = await this.ledger.getHold(transfer.id);
      return hold.status === 'CAPTURED'
        ? { type: 'completed' }
        : { type: 'rejected', reason: 'CAPTURE_UNCONFIRMED' };
    }
    await this.ledger.captureHold(transfer.id, {
      operationId: `transfer:${transfer.id}:capture`,
      toWalletId: transfer.toWalletId!,
      toAmountMinor: transfer.toAmountMinor!,
      toCurrency: transfer.toCurrency,
      fxRate: Number(transfer.fxRate),
    });
    return { type: 'completed' };
  }

  // Компенсація: холд повертається в available, ledger пише TransferFailed.
  private async releaseHold(transfer: Transfer): Promise<StepResult> {
    try {
      await this.ledger.releaseHold(
        transfer.id,
        `transfer:${transfer.id}:release`,
        transfer.failureReason ?? 'COMPENSATION',
        transfer.fromWalletId,
      );
      return { type: 'compensated' };
    } catch (error) {
      if (!(error instanceof LedgerRejection)) throw error;
      if (error.code === 'NOT_FOUND') {
        // Гаманця немає, отже й холду — повертати нічого.
        return { type: 'compensated' };
      }
      // Холд уже не активний або release з цим operationId уже виконано з
      // іншим тілом (422 повторювався б вічно): результат — за станом холду.
      if (
        error.code === 'HOLD_NOT_ACTIVE' ||
        error.code === 'IDEMPOTENCY_KEY_REUSED'
      ) {
        return this.holdOutcome(transfer);
      }
      // Компенсацію не кидаємо: повторюємо, доки ledger її не прийме.
      return { type: 'uncertain', error: `${error.code}: ${error.message}` };
    }
  }

  private async holdOutcome(transfer: Transfer): Promise<StepResult> {
    let status;
    try {
      ({ status } = await this.ledger.getHold(transfer.id));
    } catch (error) {
      // Холду так і не було (лишився лише слід зняття) — повертати нічого.
      if (error instanceof LedgerRejection && error.code === 'NOT_FOUND') {
        return { type: 'compensated' };
      }
      throw error;
    }
    if (status === 'CAPTURED') return { type: 'completed' };
    if (status === 'RELEASED') return { type: 'compensated' };
    return { type: 'uncertain', error: 'Холд досі ACTIVE' };
  }
}
