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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { EmptyDto, LimitQuery, ReconciliationQuery } from '../dto/requests.dto';
import { ProxyRequest, UpstreamService } from '../proxy/upstream.service';
import { TracesService } from './traces.service';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly upstream: UpstreamService,
    private readonly traces: TracesService,
  ) {}
  @Get('traces')
  listTraces(@Query() query: LimitQuery) {
    return this.traces.list(query.limit);
  }
  @Get('wallets/:id/events')
  events(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: ProxyRequest,
    @Res() res: Response,
  ) {
    return this.upstream.forward(
      'ledger',
      `/admin/wallets/${id}/events`,
      req,
      res,
    );
  }
  @Get('reconciliation')
  reconciliation(
    @Query() query: ReconciliationQuery,
    @Req() req: ProxyRequest,
    @Res() res: Response,
  ) {
    return this.upstream.forward(
      'ledger',
      '/admin/reconciliation',
      req,
      res,
      'GET',
      undefined,
      query,
    );
  }
  @Post('wallets/:id/freeze')
  freeze(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EmptyDto,
    @Req() req: ProxyRequest,
    @Res() res: Response,
  ) {
    return this.upstream.forward(
      'ledger',
      `/admin/wallets/${id}/freeze`,
      req,
      res,
      'POST',
      dto,
    );
  }
}
