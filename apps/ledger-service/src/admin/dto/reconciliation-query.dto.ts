import { IsISO8601, IsOptional } from 'class-validator';

// Період звірки [from, to); без меж — уся історія.
export class ReconciliationQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
