import { ConfigService } from '@nestjs/config';
import { formatMinor, toMinor } from '../src/common/money';
import { convertMinor, FxService } from '../src/fx/fx.service';

describe('гроші й курси', () => {
  it('toMinor без float-помилок', () => {
    expect(toMinor(0.29)).toBe(29n);
    expect(toMinor(10)).toBe(1000n);
    expect(formatMinor(5n)).toBe('0.05');
  });

  it('convertMinor округлює вниз до мінорних одиниць', () => {
    expect(convertMinor(1001n, '0.92000000')).toBe(920n);
    expect(convertMinor(100n, '45.10869565')).toBe(4510n);
    expect(convertMinor(1n, '0.02409639')).toBe(0n);
  });

  it('крос-курс через USD з 8 знаками; кеш тримає курс до TTL', () => {
    const fx = new FxService(
      new ConfigService({
        FX_RATES_JSON: '{"USD":1,"EUR":0.92,"UAH":41.5}',
        FX_CACHE_TTL_MS: 1000,
      }),
    );
    const t0 = new Date('2026-01-01T00:00:00Z');
    const first = fx.quote('EUR', 'UAH', t0);
    expect(first).toEqual({ rate: '45.10869565', quotedAt: t0 });
    // Із кешу: quotedAt — час отримання курсу, а не запиту.
    expect(fx.quote('USD', 'EUR', new Date(t0.getTime() + 999)).quotedAt).toEqual(t0);
    const refreshed = new Date(t0.getTime() + 1000);
    expect(fx.quote('USD', 'EUR', refreshed).quotedAt).toEqual(refreshed);
  });
});
