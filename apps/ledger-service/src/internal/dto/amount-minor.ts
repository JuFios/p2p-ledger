import { Matches } from 'class-validator';

// Сума в мінорних одиницях рядком (bigint): додатне ціле без провідних нулів.
export const IsAmountMinor = () =>
  Matches(/^[1-9]\d{0,17}$/, {
    message: '$property must be a positive integer string (minor units)',
  });
