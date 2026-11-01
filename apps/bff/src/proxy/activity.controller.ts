import { Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ActivityQuery } from '../dto/requests.dto';
import { ProxyRequest, UpstreamService } from './upstream.service';

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly upstream: UpstreamService) {}

  @Get('')
  list(
    @Req() req: ProxyRequest,
    @Res() res: Response,
    @Query() query: ActivityQuery,
  ) {
    return this.upstream.forward(
      'notifications',
      `/activity`,
      req,
      res,
      'GET',
      undefined,
      query,
    );
  }
}
