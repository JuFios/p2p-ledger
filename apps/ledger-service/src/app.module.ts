import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';
import { AdminModule } from './admin/admin.module';
import { OutboxModule } from './outbox/outbox.module';
import { entities, migrations } from './data-source';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities,
      // Схема — лише міграціями (src/migrations), застосовуються на старті.
      synchronize: false,
      migrations,
      migrationsRun: true,
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    WalletsModule,
    HealthModule,
    InternalModule,
    AdminModule,
    OutboxModule,
  ],
})
export class AppModule {}
