import { DomainEvent, postingsOf, WalletOpenedPayload } from './events';
import { applyPostings, Balances, walletIdsOf } from './postings';
import { upcast } from './upcasters';

// Баланси гаманців з нуля — згортка потоку подій (з upcaster'ами).
// initial дозволяє згортати потік порціями (reconciliation читає події батчами).
export function projectBalances(
  events: DomainEvent<unknown>[],
  initial: Balances = {},
): Balances {
  const balances: Balances = { ...initial };
  for (const event of events.map(upcast)) {
    if (event.type === 'WalletOpened') {
      const { walletId } = event.payload as WalletOpenedPayload;
      balances[walletId] = { available: 0n, held: 0n };
      continue;
    }
    // У applyPostings передаємо лише зачеплені гаманці, а не весь стан:
    // згортка лінійна за кількістю подій.
    const postings = postingsOf(event.payload);
    const touched: Balances = {};
    for (const id of walletIdsOf(postings)) {
      if (balances[id]) touched[id] = balances[id];
    }
    Object.assign(balances, applyPostings(touched, postings));
  }
  return balances;
}
