import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { parseFxRates } from '../config/env.validation';

export interface FxQuote {
  // Курс from → to рядком з 8 знаками після коми (як у колонці fx_rate).
  rate: string;
  quotedAt: Date;
}

// Курси валют (мок постачальника): FX_RATES_JSON відносно USD, кешуються на
// FX_CACHE_TTL_MS. quotedAt — коли курс отримано, а не коли його віддали з
// кешу: саме за ним сага перевіряє, чи курс не застарів.
@Injectable()
export class FxService {
  private cache?: { rates: Record<string, number>; fetchedAt: Date };

  constructor(private readonly config: ConfigService) {}

  quote(from: string, to: string, now = new Date()): FxQuote {
    const { rates, fetchedAt } = this.rates(now);
    if (!rates[from] || !rates[to]) {
      throw new Error(`Немає курсу ${from} → ${to}`);
    }
    return { rate: (rates[to] / rates[from]).toFixed(8), quotedAt: fetchedAt };
  }

  private rates(now: Date) {
    const ttl = this.config.getOrThrow<number>('FX_CACHE_TTL_MS');
    if (!this.cache || now.getTime() - this.cache.fetchedAt.getTime() >= ttl) {
      this.cache = {
        rates: parseFxRates(this.config.getOrThrow<string>('FX_RATES_JSON')),
        fetchedAt: now,
      };
    }
    return this.cache;
  }
}

// Сума зарахування за курсом, округлена вниз до мінорних одиниць: різниця
// лишається на клірингових рахунках system:fx:* у ledger.
export function convertMinor(amountMinor: bigint, rate: string): bigint {
  const [whole, fraction = ''] = rate.split('.');
  const scale = 10n ** BigInt(fraction.length);
  return (amountMinor * BigInt(whole + fraction)) / scale;
}
