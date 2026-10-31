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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSplitBillDto } from './dto/create-split-bill.dto';
import { ListSplitBillsQueryDto } from './dto/list-split-bills.dto';
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

  @Post()
  create(@Request() req: AuthenticatedRequest, @Body() dto: CreateSplitBillDto) {
    return this.bills.create(req.user, dto);
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
}
