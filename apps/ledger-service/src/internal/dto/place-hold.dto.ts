import { IsIn, IsString, IsUUID, Length } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../wallets/dto/create-wallet.dto';
import { IsAmountMinor } from './amount-minor';

export class PlaceHoldDto {
  @IsString()
  @Length(1, 200)
  operationId: string;

  @IsUUID()
  holdId: string;

  @IsUUID()
  walletId: string;

  @IsUUID()
  ownerId: string;

  @IsAmountMinor()
  amountMinor: string;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  @IsUUID()
  transferId: string;
}
