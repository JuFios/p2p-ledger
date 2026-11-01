import { plainToInstance } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Max,
  Min,
  validateSync,
} from 'class-validator';
import { hostname } from 'os';

export class EnvironmentVariables {
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3003;
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
  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;
  @IsUrl({ require_tld: false })
  CORS_ORIGIN: string = 'http://localhost:3000';
  @IsString()
  @IsNotEmpty()
  CONSUMER_NAME: string = `${hostname()}-${process.pid}`;
  @IsInt()
  @Min(1)
  CONSUMER_CLAIM_IDLE_MS: number = 30000;
  @IsInt()
  @Min(1)
  CONSUMER_MAX_DELIVERIES: number = 5;
}

export function validate(config: Record<string, unknown>) {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length) throw new Error(errors.toString());
  return validated;
}
