import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from './wallets.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';

interface AuthenticatedRequest {
  user: { userId: string; email: string; role: string };
}

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest) {
    return this.wallets.listForUser(req.user.userId);
  }

  // Гаманець створюється при першій потребі; повторний виклик повертає наявний.
  @Post()
  ensure(@Request() req: AuthenticatedRequest, @Body() dto: CreateWalletDto) {
    return this.wallets.getOrCreateForUser(req.user.userId, dto.currency);
  }

  @Get(':id')
  getOne(@Param('id') id: string) {
    return this.wallets.getById(id);
  }

  @Post(':id/deposit')
  deposit(@Param('id') id: string, @Body() dto: DepositDto) {
    return this.wallets.deposit(id, dto.amount);
  }

  @Post(':id/withdraw')
  withdraw(@Param('id') id: string, @Body() dto: WithdrawDto) {
    return this.wallets.withdraw(id, dto.amount);
  }
}
