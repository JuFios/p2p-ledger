import { validateRequiredConfig } from './config-policy';
import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  Min,
  Max,
  validateSync,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../common/currencies';

// Змінні оточення payments-service. Без обов'язкових сервіс не стартує;
// решта має значення за замовчуванням. Типи вказано явно: за ними
// enableImplicitConversion приводить рядки env до чисел.
export class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  OTEL_SERVICE_NAME: string = 'payments-service';

  @IsUrl({ require_tld: false })
  OTEL_EXPORTER_OTLP_ENDPOINT: string = 'http://localhost:4318';

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3002;

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number = 5432;

  @IsString()
  @IsNotEmpty()
  DATABASE_USER: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_PASSWORD: string;

  @IsString()
  @IsNotEmpty()
  DATABASE_NAME: string;

  @IsString()
  @IsNotEmpty()
  REDIS_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT: number = 6379;

  @IsInt()
  @Min(1)
  STREAM_MAXLEN: number = 100000;

  @IsInt()
  @Min(10)
  OUTBOX_POLL_INTERVAL_MS: number = 500;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsUrl({ require_tld: false })
  LEDGER_SERVICE_URL: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_API_TOKEN: string;

  // Курси відносно USD: {"USD":1,"EUR":0.92,"UAH":41.5}.
  @IsString()
  FX_RATES_JSON: string;

  @IsInt()
  @Min(0)
  FX_CACHE_TTL_MS: number = 30000;

  @IsInt()
  @Min(1)
  FX_MAX_QUOTE_AGE_MS: number = 60000;

  // Максимальна сума переказу в одиницях валюти переказу.
  @IsNumber()
  @IsPositive()
  TRANSFER_MAX_AMOUNT: number = 10000;

  // Чорний список email через кому.
  @IsOptional()
  @IsString()
  BLOCKED_EMAILS: string = '';

  @IsInt()
  @Min(100)
  SAGA_STEP_TIMEOUT_MS: number = 10000;

  @IsInt()
  @Min(1)
  SAGA_MAX_ATTEMPTS: number = 5;

  @IsInt()
  @Min(1)
  SAGA_RETRY_BASE_MS: number = 500;

  @IsInt()
  @Min(10)
  SAGA_RUNNER_INTERVAL_MS: number = 500;

  @IsInt()
  @Min(1)
  @Max(60000)
  CB_TIMEOUT_MS: number = 3000;

  @IsInt()
  @Min(1)
  CB_ERROR_THRESHOLD_PERCENT: number = 50;

  @IsInt()
  @Min(1)
  CB_RESET_TIMEOUT_MS: number = 10000;

  // Мінімальний інтервал між нагадуваннями про одну прострочену частку.
  @IsInt()
  @Min(1000)
  SPLIT_REMINDER_INTERVAL_MS: number = 3600000;

  @IsInt()
  @Min(1)
  TRANSFER_RATE_LIMIT: number = 10;

  @IsInt()
  @Min(1)
  TRANSFER_RATE_TTL_MS: number = 60000;
}

export function parseFxRates(json: string): Record<string, number> {
  let rates: unknown;
  try {
    rates = JSON.parse(json);
  } catch {
    throw new Error('FX_RATES_JSON: некоректний JSON');
  }
  for (const currency of SUPPORTED_CURRENCIES) {
    const rate = (rates as Record<string, unknown> | null)?.[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) {
      throw new Error(`FX_RATES_JSON: немає додатного курсу для ${currency}`);
    }
  }
  return rates as Record<string, number>;
}

// Валідація env на старті (ConfigModule.forRoot({ validate })).
export function validate(config: Record<string, unknown>) {
  validateRequiredConfig(config, ['JWT_ACCESS_SECRET', 'DATABASE_HOST', 'DATABASE_USER', 'DATABASE_PASSWORD', 'DATABASE_NAME', 'REDIS_HOST', 'INTERNAL_API_TOKEN']);
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.toString());
  }
  parseFxRates(validated.FX_RATES_JSON);
  // TRANSFER_MAX_AMOUNT порівнюється в мінорних одиницях — не більше 2 знаків.
  if (Number(validated.TRANSFER_MAX_AMOUNT.toFixed(2)) !== validated.TRANSFER_MAX_AMOUNT) {
    throw new Error('TRANSFER_MAX_AMOUNT: не більше 2 знаків після коми');
  }
  // Пов'язані таймаути: курс із кешу не має застарівати до CONFIRM, а lease
  // кроку — спливати посеред виклику ledger.
  if (validated.FX_CACHE_TTL_MS >= validated.FX_MAX_QUOTE_AGE_MS) {
    throw new Error('FX_CACHE_TTL_MS має бути меншим за FX_MAX_QUOTE_AGE_MS');
  }
  if (validated.CB_TIMEOUT_MS >= validated.SAGA_STEP_TIMEOUT_MS) {
    throw new Error('CB_TIMEOUT_MS має бути меншим за SAGA_STEP_TIMEOUT_MS');
  }
  return validated;
}
