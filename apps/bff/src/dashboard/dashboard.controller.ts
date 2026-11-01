import { Controller, Get, HttpException, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  ProxyRequest,
  Source,
  UpstreamService,
} from '../proxy/upstream.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly upstream: UpstreamService) {}

  @Get()
  async get(@Req() req: ProxyRequest) {
    const sources: [string, Source, string][] = [
      ['wallets', 'ledger', '/wallets'],
      ['transfers', 'payments', '/transfers'],
      ['activity', 'notifications', '/activity'],
    ];
    const sections = await Promise.all(
      sources.map(async ([section, source, path]) => {
        try {
          const response = await this.upstream.request(source, path, {
            req,
            query: section === 'wallets' ? undefined : { limit: 10 },
          });
          if (response.status < 200 || response.status >= 300) {
            return [
              section,
              {
                error: {
                  statusCode: response.status,
                  message: 'Source unavailable',
                },
              },
            ];
          }
          return [section, { data: response.data }];
        } catch (error) {
          if (!(error instanceof HttpException)) throw error;
          return [
            section,
            {
              error: {
                statusCode: error.getStatus(),
                message: 'Source unavailable',
              },
            },
          ];
        }
      }),
    );
    return Object.fromEntries(sections);
  }
}
