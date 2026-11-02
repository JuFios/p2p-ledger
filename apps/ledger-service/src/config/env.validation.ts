import { plainToInstance } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsNotEmpty, IsString, IsUrl, Matches, Max, Min, validateSync } from 'class-validator';

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
  const validated = plainToInstance(EnvironmentVariables, config, { enableImplicitConversion: true });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) throw new Error(errors.toString());
  if (validated.NODE_ENV === 'production') {
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'INTERNAL_API_TOKEN'] as const) {
      const value = validated[name];
      if (value.startsWith('change-me-') || value.length < 32) {
        throw new Error(`${name}: production requires a non-placeholder secret of at least 32 characters`);
      }
    }
    if (validated.ADMIN_PASSWORD.startsWith('change-me-') || validated.ADMIN_PASSWORD.length < 12) {
      throw new Error('ADMIN_PASSWORD: production requires a non-placeholder password of at least 12 characters');
    }
  }
  return validated;
}
