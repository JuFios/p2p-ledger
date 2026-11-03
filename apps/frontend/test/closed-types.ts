import { Currency, TransferStatus, TransferStep, ShareStatus, BillStatus, SplitMode } from '../lib/types';
// @ts-expect-error невідомий статус не належить контракту
const transfer: TransferStatus = 'COMPELTED';
// @ts-expect-error невідомий крок
const step: TransferStep = 'RESERVE';
// @ts-expect-error невідома валюта
const currency: Currency = 'GBP';
// @ts-expect-error невідомий статус частки
const share: ShareStatus = 'SETTLED';
// @ts-expect-error невідомий статус рахунку
const bill: BillStatus = 'PAID';
// @ts-expect-error невідомий режим
const mode: SplitMode = 'RANDOM';
void [transfer, step, currency, share, bill, mode];
