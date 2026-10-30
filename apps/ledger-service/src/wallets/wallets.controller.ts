import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from './wallets.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { IdempotencyKey } from './idempotency-key.decorator';

interface AuthenticatedRequest {
  user: { userId: string; email: string; role: string };
}

@ApiTags('wallets')
@ApiBearerAuth()
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
  getOne(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.wallets.getById(req.user.userId, id);
  }

  @Post(':id/deposit')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  deposit(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DepositDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.wallets.deposit(req.user.userId, id, dto.amount, idempotencyKey);
  }

  @Post(':id/withdraw')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  withdraw(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WithdrawDto,
    @IdempotencyKey() idempotencyKey?: string,
  ) {
    return this.wallets.withdraw(req.user.userId, id, dto.amount, idempotencyKey);
  }
}
