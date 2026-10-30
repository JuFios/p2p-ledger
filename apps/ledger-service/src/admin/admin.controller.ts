import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WalletsService } from '../wallets/wallets.service';
import { AdminService } from './admin.service';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly wallets: WalletsService,
  ) {}

  @Get('wallets/:id/events')
  walletEvents(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.walletEvents(id);
  }

  @Get('reconciliation')
  reconciliation(@Query() query: ReconciliationQueryDto) {
    return this.admin.reconcile({
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    });
  }

  // Потрібен для сценарію «отримувач заблокований»; розморожування немає.
  @Post('wallets/:id/freeze')
  @HttpCode(200)
  freeze(
    @Request() req: { user: { userId: string } },
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.wallets.freeze(req.user.userId, id);
  }
}
