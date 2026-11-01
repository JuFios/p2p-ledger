import { plainToInstance } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';

class EnvironmentVariables {
  @IsString()
  @IsNotEmpty()
  OTEL_SERVICE_NAME: string = 'bff';

  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  OTEL_EXPORTER_OTLP_ENDPOINT: string = 'http://localhost:4318';

  @IsIn(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
  LOG_LEVEL: string = 'info';

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3004;

  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  LEDGER_SERVICE_URL: string;
  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  PAYMENTS_SERVICE_URL: string;
  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  NOTIFICATIONS_SERVICE_URL: string;
  @IsUrl({
    require_tld: false,
    protocols: ['http', 'https'],
    require_protocol: true,
  })
  JAEGER_QUERY_URL: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const env = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length)
    throw new Error(
      errors
        .map((error) => Object.values(error.constraints ?? {}).join(', '))
        .join('; '),
    );
  return env;
}
