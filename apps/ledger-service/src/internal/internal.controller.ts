import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { WalletsService } from '../wallets/wallets.service';
import { HoldsService } from '../holds/holds.service';
import { ledgerNotFound } from '../ledger/ledger-errors';
import { InternalTokenGuard } from './internal-token.guard';
import { EnsureWalletDto } from './dto/ensure-wallet.dto';
import { PlaceHoldDto } from './dto/place-hold.dto';
import { ReleaseHoldDto } from './dto/release-hold.dto';
import { CaptureHoldDto } from './dto/capture-hold.dto';

// API для payments-service (сага переказу). Команди ідемпотентні за operationId.
@ApiTags('internal')
@ApiSecurity('internal-token')
@Controller('internal')
@UseGuards(InternalTokenGuard)
export class InternalController {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly wallets: WalletsService,
    private readonly holds: HoldsService,
  ) {}

  @Get('users/by-email/:email')
  async userByEmail(@Param('email') email: string) {
    const user = await this.users.findOne({ where: { email } });
    if (!user) {
      throw ledgerNotFound('Користувача не знайдено');
    }
    return { userId: user.id, email: user.email };
  }

  @Post('wallets/ensure')
  async ensureWallet(@Body() dto: EnsureWalletDto) {
    const wallet = await this.wallets.getOrCreateForUser(
      dto.userId,
      dto.currency,
    );
    return {
      walletId: wallet.id,
      ownerId: wallet.ownerId,
      currency: wallet.currency,
      frozen: wallet.frozen,
    };
  }

  @Get('wallets/:id')
  getWallet(@Param('id', ParseUUIDPipe) id: string) {
    return this.wallets.getInternal(id);
  }

  @Post('holds')
  placeHold(@Body() dto: PlaceHoldDto) {
    return this.holds.place(dto);
  }

  @Post('holds/:holdId/release')
  @HttpCode(200)
  releaseHold(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Body() dto: ReleaseHoldDto,
  ) {
    return this.holds.release(holdId, dto);
  }

  @Post('holds/:holdId/capture')
  @HttpCode(200)
  captureHold(
    @Param('holdId', ParseUUIDPipe) holdId: string,
    @Body() dto: CaptureHoldDto,
  ) {
    return this.holds.capture(holdId, dto);
  }

  @Get('holds/:holdId')
  getHold(@Param('holdId', ParseUUIDPipe) holdId: string) {
    return this.holds.get(holdId);
  }
}
