import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
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
  @IsOptional()
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
  @IsOptional()
  @IsDateString()
  dueAt?: string;
}
