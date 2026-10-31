import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosRequestConfig } from 'axios';
import CircuitBreaker from 'opossum';
import { firstValueFrom } from 'rxjs';
import {
  classifyLedgerError,
  LedgerRejection,
  LedgerUnavailable,
} from './ledger-errors';

export interface LedgerUser {
  userId: string;
  email: string;
}

export interface LedgerWalletRef {
  walletId: string;
  ownerId: string;
  currency: string;
  frozen: boolean;
}

export interface LedgerWallet extends LedgerWalletRef {
  available: string;
  held: string;
}

export type HoldStatus = 'ACTIVE' | 'RELEASED' | 'CAPTURED';

export interface LedgerHold {
  holdId: string;
  status: HoldStatus;
}

export interface PlaceHoldRequest {
  operationId: string;
  holdId: string;
  walletId: string;
  ownerId: string;
  amountMinor: string;
  currency: string;
  transferId: string;
}

export interface CaptureHoldRequest {
  operationId: string;
  toWalletId: string;
  toAmountMinor: string;
  toCurrency: string;
  fxRate: number;
}

// Клієнт internal API ledger-service. Усі виклики йдуть через circuit breaker:
// поки ledger лежить, breaker відкритий і виклик одразу завершується
// LedgerUnavailable — сага переходить в AWAITING_RETRY, а не висить на таймаутах.
// Остаточні відмови (4xx) breaker не рахує як збої ledger.
@Injectable()
export class LedgerClient implements OnModuleDestroy {
  private readonly logger = new Logger(LedgerClient.name);
  private readonly breaker: CircuitBreaker<[AxiosRequestConfig], unknown>;

  constructor(
    private readonly http: HttpService,
    config: ConfigService,
  ) {
    this.breaker = new CircuitBreaker(
      async (request: AxiosRequestConfig) => {
        try {
          return (await firstValueFrom(this.http.request(request))).data;
        } catch (error) {
          throw classifyLedgerError(error);
        }
      },
      {
        timeout: config.getOrThrow<number>('CB_TIMEOUT_MS'),
        errorThresholdPercentage: config.getOrThrow<number>(
          'CB_ERROR_THRESHOLD_PERCENT',
        ),
        resetTimeout: config.getOrThrow<number>('CB_RESET_TIMEOUT_MS'),
        errorFilter: (error) => error instanceof LedgerRejection,
      },
    );
    this.breaker.on('open', () => this.logger.warn('Circuit breaker ledger: open'));
    this.breaker.on('close', () => this.logger.log('Circuit breaker ledger: closed'));
  }

  // Зупиняє таймери статистики breaker'а.
  onModuleDestroy() {
    this.breaker.shutdown();
  }

  findUserByEmail(email: string) {
    return this.call<LedgerUser>({
      method: 'GET',
      url: `/internal/users/by-email/${encodeURIComponent(email)}`,
    });
  }

  ensureWallet(userId: string, currency: string) {
    return this.call<LedgerWalletRef>({
      method: 'POST',
      url: '/internal/wallets/ensure',
      data: { userId, currency },
    });
  }

  getWallet(walletId: string) {
    return this.call<LedgerWallet>({
      method: 'GET',
      url: `/internal/wallets/${walletId}`,
    });
  }

  placeHold(request: PlaceHoldRequest) {
    return this.call<LedgerHold>({
      method: 'POST',
      url: '/internal/holds',
      data: request,
    });
  }

  // walletId — гаманець відправника: за ним ledger знімає й холд, якого ще
  // не бачив (запит на холд застряг), щоб запізнілий холд не лишився в held.
  releaseHold(
    holdId: string,
    operationId: string,
    reason?: string,
    walletId?: string,
  ) {
    return this.call<LedgerHold>({
      method: 'POST',
      url: `/internal/holds/${holdId}/release`,
      data: { operationId, reason, walletId },
    });
  }

  captureHold(holdId: string, request: CaptureHoldRequest) {
    return this.call<LedgerHold>({
      method: 'POST',
      url: `/internal/holds/${holdId}/capture`,
      data: request,
    });
  }

  getHold(holdId: string) {
    return this.call<LedgerHold>({
      method: 'GET',
      url: `/internal/holds/${holdId}`,
    });
  }

  // Назовні — лише LedgerRejection або LedgerUnavailable (breaker open,
  // таймаут breaker'а, мережа, 5xx).
  private async call<T>(request: AxiosRequestConfig): Promise<T> {
    try {
      return (await this.breaker.fire(request)) as T;
    } catch (error) {
      if (error instanceof LedgerRejection || error instanceof LedgerUnavailable) {
        throw error;
      }
      throw new LedgerUnavailable(`ledger: ${(error as Error).message}`);
    }
  }
}
