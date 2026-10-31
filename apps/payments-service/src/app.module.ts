import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { TransfersModule } from './transfers/transfers.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { SagaModule } from './saga/saga.module';
import { OutboxModule } from './outbox/outbox.module';
import { validate } from './config/env.validation';
import { entities, migrations } from './data-source';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DATABASE_HOST'),
        port: config.getOrThrow<number>('DATABASE_PORT'),
        username: config.getOrThrow<string>('DATABASE_USER'),
        password: config.getOrThrow<string>('DATABASE_PASSWORD'),
        database: config.getOrThrow<string>('DATABASE_NAME'),
        entities,
        // Схема — лише міграціями (src/migrations), застосовуються на старті.
        synchronize: false,
        migrations,
        migrationsRun: true,
      }),
    }),
    ScheduleModule.forRoot(),
    // Застосовується лише там, де стоїть TransferThrottlerGuard (POST /transfers).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          limit: config.getOrThrow<number>('TRANSFER_RATE_LIMIT'),
          ttl: config.getOrThrow<number>('TRANSFER_RATE_TTL_MS'),
        },
      ],
    }),
    AuthModule,
    TransfersModule,
    HealthModule,
    SagaModule,
    OutboxModule,
  ],
})
export class AppModule {}
