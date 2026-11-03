import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsIn,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { SUPPORTED_CURRENCIES } from '../../common/currencies';
import { IsMoneyAmount } from '../../common/is-money-amount';
import { SPLIT_MODES, SplitMode } from '../entities/split-bill.entity';

export const MAX_PARTICIPANTS = 20;

export class SplitParticipantDto {
  // Лише email, як і одержувач переказу.
  @IsEmail()
  email: string;

  // Лише для режиму CUSTOM.
  @ValidateIf((_object, value) => value !== undefined)
  @IsMoneyAmount()
  amount?: number;
}

export class CreateSplitBillDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  @IsMoneyAmount()
  totalAmount: number;

  @IsIn(SUPPORTED_CURRENCIES)
  currency: string;

  // EQUAL — порівну (залишок копійок першому учаснику); CUSTOM — суми задає
  // ініціатор, їх сума має дорівнювати totalAmount.
  @IsIn(SPLIT_MODES)
  mode: SplitMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTICIPANTS)
  @ValidateNested({ each: true })
  @Type(() => SplitParticipantDto)
  participants: SplitParticipantDto[];

  // Термін оплати; частки, не сплачені до нього, вважаються простроченими.
  // strict: інакше 2026-02-31 пройшло б перевірку й зсунулось на 3 березня.
  @IsOptional()
  @IsISO8601({ strict: true })
  dueAt?: string;
}
