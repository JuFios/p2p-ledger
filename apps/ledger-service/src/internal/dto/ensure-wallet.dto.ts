import { IsIn, IsUUID } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../wallets/dto/create-wallet.dto';

export class EnsureWalletDto {
  @IsUUID()
  userId: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
