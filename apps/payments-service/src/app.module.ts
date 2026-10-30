import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransfersModule } from './transfers/transfers.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TransfersModule,
    HealthModule,
  ],
})
export class AppModule {}
