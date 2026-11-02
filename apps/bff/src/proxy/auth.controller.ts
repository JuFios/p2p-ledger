import { Body, Controller, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { LoginDto, RefreshDto, RegisterDto } from '../dto/requests.dto';
import { ProxyRequest, UpstreamService } from './upstream.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly upstream: UpstreamService) {}
  @Post('logout')
  logout(@Body() dto: RefreshDto, @Req() req: ProxyRequest, @Res() res: Response) {
    return this.upstream.forward('ledger', '/auth/logout', req, res, 'POST', dto);
  }
  @Post('register')
  register(
    @Body() dto: RegisterDto,
    @Req() req: ProxyRequest,
    @Res() res: Response,
  ) {
    return this.upstream.forward(
      'ledger',
      '/auth/register',
      req,
      res,
      'POST',
      dto,
    );
  }
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: ProxyRequest, @Res() res: Response) {
    return this.upstream.forward(
      'ledger',
      '/auth/login',
      req,
      res,
      'POST',
      dto,
    );
  }
  @Post('refresh')
  refresh(
    @Body() dto: RefreshDto,
    @Req() req: ProxyRequest,
    @Res() res: Response,
  ) {
    return this.upstream.forward(
      'ledger',
      '/auth/refresh',
      req,
      res,
      'POST',
      dto,
    );
  }
}
