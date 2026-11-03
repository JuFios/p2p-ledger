import { IsOptional } from 'class-validator';

import { IsCalendarDate } from '../../common/is-calendar-date';

// Період звірки [from, to); без меж — уся історія.
export class ReconciliationQueryDto {
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
