import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { HealthModule } from './health/health.module';
import { User } from './auth/entities/user.entity';
import { Wallet } from './wallets/entities/wallet.entity';
import { validate } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DATABASE_HOST,
      port: Number(process.env.DATABASE_PORT ?? 5432),
      username: process.env.DATABASE_USER,
      password: process.env.DATABASE_PASSWORD,
      database: process.env.DATABASE_NAME,
      entities: [User, Wallet],
      synchronize: true, // OK для стартового репо; у бойовому коді — міграції
    }),
    AuthModule,
    WalletsModule,
    HealthModule,
  ],
})
export class AppModule {}
