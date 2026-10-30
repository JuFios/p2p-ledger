import { IsNumber, IsPositive, Max } from 'class-validator';

export class WithdrawDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000)
  amount: number;
}
