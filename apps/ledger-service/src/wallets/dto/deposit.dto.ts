import { IsMoneyAmount } from './is-money-amount';

export class DepositDto {
  @IsMoneyAmount()
  amount: number;
}
