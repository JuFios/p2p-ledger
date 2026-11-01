import { ObservabilityModule } from './observability/observability.module';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TerminusModule } from '@nestjs/terminus';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { ActivityController } from './activity/activity.controller';
import { validate } from './config/env.validation';
import { entities, migrations } from './data-source';
import { EventHandler } from './events/event-handler.service';
import { NotificationsGateway } from './events/notifications.gateway';
import { StreamConsumer } from './events/stream-consumer.service';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    ObservabilityModule,
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
        migrations,
        synchronize: false,
        migrationsRun: true,
      }),
    }),
    AuthModule,
    JwtModule.register({}),
    TerminusModule,
  ],
  controllers: [HealthController, ActivityController],
  providers: [NotificationsGateway, EventHandler, StreamConsumer],
})
export class AppModule {}
