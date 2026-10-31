import { IsUUID } from 'class-validator';

// Гаманець, з якого учасник сплачує свою частку; Idempotency-Key — заголовок.
export class PayShareDto {
  @IsUUID()
  fromWalletId: string;
}
