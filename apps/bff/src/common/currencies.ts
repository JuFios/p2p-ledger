export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
export type Currency = (typeof SUPPORTED_CURRENCIES)[number];
