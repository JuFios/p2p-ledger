import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CreateSplitBillDto,
  CreateTransferDto,
  EmptyDto,
  LimitQuery,
  PayShareDto,
} from '../dto/requests.dto';
import { ProxyRequest, UpstreamService } from './upstream.service';

@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('')
export class PaymentsController {
  constructor(private readonly upstream: UpstreamService) {}

  @Post('transfers')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  createTransfer(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Body() dto: CreateTransferDto,
  ) {
    return this.upstream.forward(
      'payments',
      `/transfers`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }

  @Get('transfers')
  listTransfers(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Query() query: LimitQuery,
  ) {
    return this.upstream.forward(
      'payments',
      `/transfers`,
      req,
      res,
      'GET',
      undefined,
      query,
    );
  }

  @Get('transfers/:id')
  getTransfer(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.upstream.forward(
      'payments',
      `/transfers/${id}`,
      req,
      res,
      'GET',
      undefined,
      undefined,
    );
  }

  @Post('split-bills')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  createSplitBill(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Body() dto: CreateSplitBillDto,
  ) {
    return this.upstream.forward(
      'payments',
      `/split-bills`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }

  @Get('split-bills')
  listSplitBills(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Query() query: LimitQuery,
  ) {
    return this.upstream.forward(
      'payments',
      `/split-bills`,
      req,
      res,
      'GET',
      undefined,
      query,
    );
  }

  @Get('split-bills/:id')
  getSplitBill(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.upstream.forward(
      'payments',
      `/split-bills/${id}`,
      req,
      res,
      'GET',
      undefined,
      undefined,
    );
  }

  @Post('split-bills/:id/shares/:shareId/accept')
  acceptShare(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: EmptyDto,
  ) {
    return this.upstream.forward(
      'payments',
      `/split-bills/${id}/shares/${shareId}/accept`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }

  @Post('split-bills/:id/shares/:shareId/pay')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: { type: 'string', minLength: 1, maxLength: 128 },
  })
  payShare(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('shareId', ParseUUIDPipe) shareId: string,
    @Body() dto: PayShareDto,
  ) {
    return this.upstream.forward(
      'payments',
      `/split-bills/${id}/shares/${shareId}/pay`,
      req,
      res,
      'POST',
      dto,
      undefined,
    );
  }
}
