import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DataSource } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthUser } from '../auth/jwt.strategy';
import { ACTIVITY_TYPES, Activity, ActivityType } from './activity.entity';

export class ActivityQuery {
  @ApiPropertyOptional({ enum: ACTIVITY_TYPES })
  @IsOptional()
  @IsIn(ACTIVITY_TYPES)
  type?: ActivityType;
  @ApiPropertyOptional({ default: 50, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}

@ApiTags('activity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('activity')
export class ActivityController {
  constructor(private readonly dataSource: DataSource) {}
  @Get()
  list(@Req() req: { user: AuthUser }, @Query() query: ActivityQuery) {
    return this.dataSource.getRepository(Activity).find({
      where: {
        userId: req.user.userId,
        ...(query.type ? { type: query.type } : {}),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: query.limit,
    });
  }
}
