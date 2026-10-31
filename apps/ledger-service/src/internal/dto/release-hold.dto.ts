import { IsOptional, IsString, Length } from 'class-validator';

export class ReleaseHoldDto {
  @IsString()
  @Length(1, 200)
  operationId: string;

  // Причина відмови саги: з нею release пише ще й TransferFailed.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;
}
