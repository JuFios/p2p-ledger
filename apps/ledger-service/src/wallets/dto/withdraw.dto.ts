import { IsMoneyAmount } from './is-money-amount';

export class WithdrawDto {
  @IsMoneyAmount()
  amount: number;
}
