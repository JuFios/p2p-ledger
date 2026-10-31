import { IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/currencies';
import { IsMoneyAmount } from '../../common/is-money-amount';

// Ключ ідемпотентності передається заголовком Idempotency-Key, а не полем тіла.
export class CreateTransferDto {
  @IsUUID()
  fromWalletId: string;

  // Лише email: username в auth-модулі немає.
  @IsEmail()
  toWalletIdentifier: string; // email отримувача

  @IsMoneyAmount()
  amount: number;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  // Валюта зарахування; за замовчуванням = currency.
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  toCurrency?: string;
}
