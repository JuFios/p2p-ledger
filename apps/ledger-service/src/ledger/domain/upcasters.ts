import {
  CURRENT_SCHEMA_VERSION,
  DomainEvent,
  MoneyMovedPayload,
} from './events';
import { parseMinor } from './money';
import { depositPostings } from './postings';

type Upcaster = (payload: never) => unknown;

// Тип події → версія, з якої піднімаємо (v → v + 1). Події в сховищі
// не переписуються: стара версія лишається як є, нова форма — лише при читанні.
const upcasters: Record<string, Record<number, Upcaster>> = {
  MoneyDeposited: {
    // v1 зберігав суму рядком у валюті й не мав проводок.
    1: (payload: {
      walletId: string;
      currency: string;
      amount: string;
    }): MoneyMovedPayload => {
      const amountMinor = parseMinor(payload.amount);
      return {
        walletId: payload.walletId,
        currency: payload.currency,
        amountMinor: amountMinor.toString(),
        postings: depositPostings(
          payload.walletId,
          payload.currency,
          amountMinor,
        ),
      };
    },
  },
};

export function upcast(event: DomainEvent<unknown>): DomainEvent<unknown> {
  const target = CURRENT_SCHEMA_VERSION[event.type] ?? event.schemaVersion;
  let { schemaVersion, payload } = event;
  while (schemaVersion < target) {
    const up = upcasters[event.type]?.[schemaVersion];
    if (!up) {
      throw new Error(`Немає upcaster'а для ${event.type} v${schemaVersion}`);
    }
    payload = up(payload as never);
    schemaVersion += 1;
  }
  return { ...event, schemaVersion, payload };
}
