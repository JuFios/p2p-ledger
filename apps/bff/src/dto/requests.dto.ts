import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { MAX_AMOUNT, IsMoneyAmount } from '../common/is-money-amount';

import { IsCalendarDate } from '../common/is-calendar-date';

import { SUPPORTED_CURRENCIES } from '../common/currencies';
export class LoginDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() password: string;
}
export class RegisterDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password: string;
}
export class RefreshDto {
  @ApiProperty() @IsString() refreshToken: string;
}
export class CreateWalletDto {
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
}
export class MoneyDto {
  @ApiProperty({ minimum: 0.01, maximum: MAX_AMOUNT, multipleOf: 0.01 })
  @IsMoneyAmount()
  amount: number;
}
export class CreateTransferDto extends MoneyDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fromWalletId: string;
  @ApiProperty({ format: 'email' }) @IsEmail() toWalletIdentifier: string;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @ApiPropertyOptional({ enum: SUPPORTED_CURRENCIES })
  @IsOptional()
  @IsIn(SUPPORTED_CURRENCIES)
  toCurrency?: string;
}
export class SplitParticipantDto {
  @ApiProperty({ format: 'email' }) @IsEmail() email: string;
  @ApiPropertyOptional({ minimum: 0.01, maximum: MAX_AMOUNT })
  @ValidateIf((_object, value) => value !== undefined)
  @IsMoneyAmount()
  amount?: number;
}
export class CreateSplitBillDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;
  @ApiProperty({ minimum: 0.01, maximum: MAX_AMOUNT })
  @IsMoneyAmount()
  totalAmount: number;
  @ApiProperty({ enum: SUPPORTED_CURRENCIES }) @IsIn(SUPPORTED_CURRENCIES) currency: string;
  @ApiProperty({ enum: ['EQUAL', 'CUSTOM'] })
  @IsIn(['EQUAL', 'CUSTOM'])
  mode: string;
  @ApiProperty({ type: [SplitParticipantDto], minItems: 1, maxItems: 20 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SplitParticipantDto)
  participants: SplitParticipantDto[];
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}
export class PayShareDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() fromWalletId: string;
}
export class EmptyDto {}
export class LimitQuery {
  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
export class ActivityQuery extends LimitQuery {
  @ApiPropertyOptional({
    enum: [
      'DEPOSIT',
      'WITHDRAWAL',
      'TRANSFER_SENT',
      'TRANSFER_RECEIVED',
      'TRANSFER_FAILED',
      'SPLIT_BILL',
      'SPLIT_REMINDER',
    ],
  })
  @IsOptional()
  @IsIn([
    'DEPOSIT',
    'WITHDRAWAL',
    'TRANSFER_SENT',
    'TRANSFER_RECEIVED',
    'TRANSFER_FAILED',
    'SPLIT_BILL',
    'SPLIT_REMINDER',
  ])
  type?: string;
}
export class ReconciliationQuery {
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;
  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}
