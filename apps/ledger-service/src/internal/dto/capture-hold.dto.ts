import { IsIn, IsNumber, IsPositive, IsString, IsUUID, Length } from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/currencies';
import { IsAmountMinor } from './amount-minor';

export class CaptureHoldDto {
  @IsString()
  @Length(1, 200)
  operationId: string;

  @IsUUID()
  toWalletId: string;

  @IsAmountMinor()
  toAmountMinor: string;

  @IsIn(SUPPORTED_CURRENCIES)
  toCurrency: string;

  @IsNumber()
  @IsPositive()
  fxRate: number;
}
