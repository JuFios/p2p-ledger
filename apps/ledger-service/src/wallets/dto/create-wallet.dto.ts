import { IsIn } from 'class-validator';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'UAH'];

export class CreateWalletDto {
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
