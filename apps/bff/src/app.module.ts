import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { AuthModule } from './auth/auth.module';
import { validate } from './config/env.validation';
import { ObservabilityModule } from './observability/observability.module';
import { UpstreamService } from './proxy/upstream.service';
import { AuthController } from './proxy/auth.controller';
import { WalletsController } from './proxy/wallets.controller';
import { PaymentsController } from './proxy/payments.controller';
import { ActivityController } from './proxy/activity.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { AdminController } from './admin/admin.controller';
import { TracesService } from './admin/traces.service';
import { HealthController } from './health/health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate }),
    HttpModule,
    AuthModule,
    ObservabilityModule,
    TerminusModule,
  ],
  controllers: [
    AuthController,
    WalletsController,
    PaymentsController,
    ActivityController,
    DashboardController,
    AdminController,
    HealthController,
  ],
  providers: [UpstreamService, TracesService],
})
export class AppModule {}
