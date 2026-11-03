import { IsIn } from 'class-validator';

import { SUPPORTED_CURRENCIES } from '../../common/currencies';

export class CreateWalletDto {
  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;
}
