import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { AuthUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  IdempotencyKey,
  OptionalIdempotencyKey,
} from '../common/idempotency-key.decorator';
import { TransferThrottlerGuard } from '../transfers/transfer-throttler.guard';
import { CreateSplitBillDto } from './dto/create-split-bill.dto';
import { ListSplitBillsQueryDto } from './dto/list-split-bills.dto';
import { PayShareDto } from './dto/pay-share.dto';
import { SplitBillsService } from './split-bills.service';

interface AuthenticatedRequest {
  user: AuthUser;
}

@ApiTags('split-bills')
@ApiBearerAuth()
@Controller('split-bills')
@UseGuards(JwtAuthGuard)
export class SplitBillsController {
  constructor(private readonly bills: SplitBillsService) {}

  // 201 — рахунок створено; повтор з тим самим Idempotency-Key (необов'язковим)
  // — 200 і той самий рахунок.
  @Post()
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  async create(
    @Request() req: AuthenticatedRequest,
    @OptionalIdempotencyKey() idempotencyKey: string | undefined,
    @Body() dto: CreateSplitBillDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, bill } = await this.bills.create(
      req.user,
      dto,
      idempotencyKey,
    );
    res.status(created ? 201 : 200);
    return bill;
  }

  @Get()
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListSplitBillsQueryDto,
  ) {
    return this.bills.listForUser(req.user.userId, query.limit);
  }

  @Get(':id')
  get(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.bills.getForUser(req.user.userId, id);
  }

  // Учасник підтверджує свою частку.
  @Post(':id/shares/:shareId/accept')
  @HttpCode(200)
  accept(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
  ) {
    return this.bills.accept(req.user.userId, id, shareId);
  }

  // Сплата частки — переказ на ініціатора, лише з ACCEPTED. 202 — переказ
  // прийнято (далі сага), повтор з тим самим Idempotency-Key — 200.
  @Post(':id/shares/:shareId/pay')
  @UseGuards(TransferThrottlerGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async pay(
    @Request() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: PayShareDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, transfer } = await this.bills.pay(
      req.user,
      idempotencyKey,
      id,
      shareId,
      dto,
    );
    res.status(created ? 202 : 200);
    return transfer;
  }
}
