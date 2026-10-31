import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { WalletsModule } from '../wallets/wallets.module';
import { HoldsModule } from '../holds/holds.module';
import { InternalController } from './internal.controller';
import { InternalTokenGuard } from './internal-token.guard';

@Module({
  imports: [TypeOrmModule.forFeature([User]), WalletsModule, HoldsModule],
  controllers: [InternalController],
  providers: [InternalTokenGuard],
})
export class InternalModule {}
