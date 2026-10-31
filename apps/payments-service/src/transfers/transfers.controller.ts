import {
  Body,
  Controller,
  Get,
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
import { IdempotencyKey } from '../common/idempotency-key.decorator';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { ListTransfersQueryDto } from './dto/list-transfers.dto';
import { TransferThrottlerGuard } from './transfer-throttler.guard';

interface AuthenticatedRequest {
  user: AuthUser;
}

@ApiTags('transfers')
@ApiBearerAuth()
@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  // 202 — переказ прийнято, сага виконується асинхронно (статус — GET /:id
  // або WebSocket). Повтор з тим самим Idempotency-Key — 200 і той самий переказ.
  @Post()
  @UseGuards(TransferThrottlerGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async create(
    @Request() req: AuthenticatedRequest,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateTransferDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { created, transfer } = await this.transfers.create(
      req.user,
      idempotencyKey,
      dto,
    );
    res.status(created ? 202 : 200);
    return transfer;
  }

  @Get()
  list(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListTransfersQueryDto,
  ) {
    return this.transfers.listForUser(req.user.userId, query.limit);
  }

  @Get(':id')
  getStatus(
    @Request() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.transfers.getForUser(req.user.userId, id);
  }
}
