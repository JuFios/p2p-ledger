import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class ReleaseHoldDto {
  @IsString()
  @Length(1, 200)
  operationId: string;

  // Причина відмови саги: з нею release пише ще й TransferFailed.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  // Гаманець відправника. Потрібен, щоб зняти холд, якого ledger ще не бачив
  // (запит на холд застряг): release блокує гаманець і лишає слід, після чого
  // запізнілий place відхиляється.
  @IsOptional()
  @IsUUID()
  walletId?: string;
}
