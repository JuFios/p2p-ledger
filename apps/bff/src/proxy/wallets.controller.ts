import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateWalletDto, MoneyDto } from '../dto/requests.dto';
import { ProxyRequest, UpstreamService } from './upstream.service';

@ApiTags('wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallets')
export class WalletsController {
  constructor(private readonly upstream: UpstreamService) {}

  @Get('')
  list(@Req() req: ProxyRequest, @Res() res: Response) {
    return this.upstream.forward(
      'ledger',
      `/wallets`,
      req,
      res,
      'GET',
      undefined,
      undefined,
    );
  }

  @Post('')
  create(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Body() dto: CreateWalletDto,
  ) {
    return this.upstream.forward(
      'ledger',
      `/wallets`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }

  @Get(':id')
  get(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.upstream.forward(
      'ledger',
      `/wallets/${id}`,
      req,
      res,
      'GET',
      undefined,
      undefined,
    );
  }

  @Post(':id/deposit')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  deposit(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoneyDto,
  ) {
    return this.upstream.forward(
      'ledger',
      `/wallets/${id}/deposit`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }

  @Post(':id/withdraw')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  withdraw(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MoneyDto,
  ) {
    return this.upstream.forward(
      'ledger',
      `/wallets/${id}/withdraw`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }
}
