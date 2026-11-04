import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { clientIp } from './auth/guards/login-throttler.guard';
import { WalletsModule } from './wallets/wallets.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { AdminModule } from './admin/admin.module';
import { OutboxModule } from './outbox/outbox.module';
import { ObservabilityModule } from './observability/observability.module';
import { entities, migrations } from './data-source';
import { validate } from './config/env.validation';
import { readDatabaseEnvironment } from './config/runtime-env';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ObservabilityModule,
    TypeOrmModule.forRoot({
      type: 'postgres',
      ...readDatabaseEnvironment(),
      entities,
      // Схема — лише міграціями (src/migrations), застосовуються на старті.
      synchronize: false,
      migrations,
      migrationsRun: true,
    }),
    ScheduleModule.forRoot(),
    // Застосовується лише там, де стоїть LoginThrottlerGuard (POST /auth/login):
    // за email і окремо за IP клієнта, вікно спільне.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          limit: Number(config.get('LOGIN_RATE_LIMIT', 5)),
          ttl: Number(config.get('LOGIN_RATE_TTL_MS', 60000)),
        },
        {
          name: 'ip',
          limit: Number(config.get('LOGIN_IP_RATE_LIMIT', 20)),
          ttl: Number(config.get('LOGIN_RATE_TTL_MS', 60000)),
          getTracker: clientIp,
        },
      ],
    }),
    AuthModule,
    WalletsModule,
    HealthModule,
    InternalModule,
    AdminModule,
    OutboxModule,
  ],
})
export class AppModule {}
