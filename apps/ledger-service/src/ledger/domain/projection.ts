import { DomainEvent, postingsOf, WalletOpenedPayload } from './events';
import { applyPostings, Balances } from './postings';
import { upcast } from './upcasters';

// Баланси гаманців з нуля — згортка потоку подій (з upcaster'ами).
export function projectBalances(events: DomainEvent<unknown>[]): Balances {
  return events.map(upcast).reduce<Balances>((balances, event) => {
    if (event.type === 'WalletOpened') {
      const { walletId } = event.payload as WalletOpenedPayload;
      return { ...balances, [walletId]: { available: 0n, held: 0n } };
    }
    return applyPostings(balances, postingsOf(event.payload));
  }, {});
}
