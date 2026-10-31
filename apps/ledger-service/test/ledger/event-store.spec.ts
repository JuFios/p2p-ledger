import { EntityManager } from 'typeorm';
import { EventStore } from '../../src/ledger/event-store';
import {
  depositPostings,
  UnbalancedPostingsError,
} from '../../src/ledger/domain/postings';

describe('EventStore.append', () => {
  const manager = () => {
    const insert = jest.fn().mockResolvedValue({
      identifiers: [{ globalPosition: '1' }],
    });
    return { insert, entity: { insert } as unknown as EntityManager };
  };
  const metadata = { operationId: 'op-1' };

  it('грошова подія без проводок не записується', async () => {
    const { insert, entity } = manager();
    await expect(
      new EventStore().append(entity, 'w-1', 0, [
        {
          type: 'MoneyDeposited',
          payload: { walletId: 'w-1', amountMinor: '100' },
          metadata,
        },
      ]),
    ).rejects.toBeInstanceOf(UnbalancedPostingsError);
    expect(insert).not.toHaveBeenCalled();
  });

  it('подія без грошового руху записується без проводок', async () => {
    const { insert, entity } = manager();
    await new EventStore().append(entity, 'w-1', 0, [
      { type: 'TransferInitiated', payload: { transferId: 't-1' }, metadata },
    ]);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('грошова подія з проводками пише подію й проводки', async () => {
    const { insert, entity } = manager();
    await new EventStore().append(entity, 'w-1', 0, [
      {
        type: 'MoneyDeposited',
        payload: { postings: depositPostings('w-1', 'USD', 100n) },
        metadata,
      },
    ]);
    expect(insert).toHaveBeenCalledTimes(2);
  });
});
