import { plainToInstance } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { validateRequiredConfig } from './config-policy';

export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsString()
  @IsNotEmpty()
  DATABASE_HOST: string;

  @IsInt()
  @Min(1)
  @Max(65535)
  DATABASE_PORT: number;

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
  REDIS_PORT: number;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsString()
  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsString()
  @IsNotEmpty()
  INTERNAL_API_TOKEN: string;

  @IsEmail()
  ADMIN_EMAIL: string;

  @IsString()
  @IsNotEmpty()
  ADMIN_PASSWORD: string;

  @IsString()
  @Matches(/^[1-9]\d*(ms|s|m|h|d|w|y)?$/)
  JWT_ACCESS_TTL: string = '15m';

  @IsString()
  @Matches(/^[1-9]\d*(ms|s|m|h|d|w|y)?$/)
  JWT_REFRESH_TTL: string = '7d';

  @IsInt()
  @Min(1)
  STREAM_MAXLEN: number = 100000;

  @IsInt()
  @Min(1)
  OUTBOX_POLL_INTERVAL_MS: number = 500;

  @IsInt()
  @Min(1)
  LOGIN_RATE_LIMIT: number = 5;

  @IsInt()
  @Min(1)
  LOGIN_RATE_TTL_MS: number = 60000;

  @IsString()
  @IsNotEmpty()
  OTEL_SERVICE_NAME: string = 'ledger-service';

  @IsUrl({ require_tld: false })
  OTEL_EXPORTER_OTLP_ENDPOINT: string = 'http://localhost:4318';

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

}

export function validate(config: Record<string, unknown>) {
  validateRequiredConfig(config, [
    'JWT_ACCESS_SECRET',
    'DATABASE_HOST',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
    'DATABASE_NAME',
    'REDIS_HOST',
    'INTERNAL_API_TOKEN',
    'JWT_REFRESH_SECRET',
    'ADMIN_PASSWORD',
  ], ['ADMIN_PASSWORD']);
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) throw new Error(errors.toString());
  return validated;
}
