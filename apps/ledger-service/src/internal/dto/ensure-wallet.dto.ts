import { IsIn, IsUUID } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/currencies';

export class EnsureWalletDto {
  @IsUUID()
  userId: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
