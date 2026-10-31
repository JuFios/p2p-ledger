import { Module } from '@nestjs/common';
import { WalletsModule } from '../wallets/wallets.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminSeedService } from './admin-seed.service';
import { RolesGuard } from '../auth/guards/roles.guard';

@Module({
  imports: [WalletsModule],
  controllers: [AdminController],
  providers: [AdminService, AdminSeedService, RolesGuard],
})
export class AdminModule {}
