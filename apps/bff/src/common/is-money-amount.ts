import { registerDecorator, ValidationOptions } from 'class-validator';

export const MAX_AMOUNT = 1_000_000;

// Додатне число до MAX_AMOUNT не більше ніж з 2 знаками після коми.
// Власна перевірка замість @IsNumber({ maxDecimalPlaces }): та падає з TypeError
// (HTTP 500) на числах, що друкуються як 1e-7, бо шукає крапку в рядку.
export function isMoneyAmount(value: unknown): boolean {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= MAX_AMOUNT &&
    Number(value.toFixed(2)) === value
  );
}

export function IsMoneyAmount(options?: ValidationOptions) {
  return (target: object, propertyName: string) =>
    registerDecorator({
      name: 'isMoneyAmount',
      target: target.constructor,
      propertyName,
      options: {
        message: `amount must be a positive number up to ${MAX_AMOUNT} with at most 2 decimal places`,
        ...options,
      },
      validator: { validate: isMoneyAmount },
    });
}
