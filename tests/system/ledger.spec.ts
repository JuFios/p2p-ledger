import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import {
  Activity,
  Currency,
  LedgerEvent,
  Transfer,
  Wallet,
  admin,
  api,
  assertBalance,
  assertEventBalances,
  eventually,
  events,
  minor,
  money,
  readWallet,
  reconcile,
  send,
  terminal,
  user,
  wallet,
} from './helpers';

describe('Distributed ledger through BFF', () => {
  let adminToken: string;
  beforeAll(async () => {
    adminToken = await admin();
  });

  it('converts USD to EUR with matching balances, journal, activity and reconciliation', async () => {
    // Незалежні очікувані суми для фікстури EUR/USD у docker-compose.test.yml.
    const sender = await user();
    const recipient = await user();
    const from = await wallet(sender, 'USD', 100);
    const to = await wallet(recipient, 'EUR');
    const created = await send(sender, from, recipient, 10.29, 'EUR');
    expect(created.status).toBe(202);
    const result = await terminal(sender, created.body.id);
    expect(result).toMatchObject({
      status: 'COMPLETED',
      step: 'DONE',
      amount: '10.29',
      toAmount: '9.46',
      failureReason: null,
    });
    const senderWallet = await readWallet(sender, from.id);
    const recipientWallet = await readWallet(recipient, to.id);
    assertBalance(senderWallet, 8971n);
    assertBalance(recipientWallet, 946n);
    const senderLog = await events(adminToken, from.id);
    const recipientLog = await events(adminToken, to.id);
    const transferEvents = senderLog.filter(
      (e) => e.metadata.transferId === result.id,
    );
    expect(transferEvents.map((e) => e.type)).toEqual([
      'TransferInitiated',
      'HoldPlaced',
      'TransferCompleted',
    ]);
    const completed = transferEvents[2];
    expect(completed.payload.postings).toEqual(
      expect.arrayContaining([
        {
          account: `wallet:${from.id}:held`,
          direction: 'DEBIT',
          currency: 'USD',
          amountMinor: '1029',
        },
        {
          account: 'system:fx:USD',
          direction: 'CREDIT',
          currency: 'USD',
          amountMinor: '1029',
        },
        {
          account: 'system:fx:EUR',
          direction: 'DEBIT',
          currency: 'EUR',
          amountMinor: '946',
        },
        {
          account: `wallet:${to.id}:available`,
          direction: 'CREDIT',
          currency: 'EUR',
          amountMinor: '946',
        },
      ]),
    );
    expect(completed.payload.postings).toHaveLength(4);
    expect(
      recipientLog
        .filter((e) => e.type === 'TransferCompleted')
        .map((e) => e.eventId),
    ).toEqual([completed.eventId]);
    assertEventBalances(senderLog, senderWallet);
    assertEventBalances(recipientLog, recipientWallet);
    for (const [owner, type] of [
      [sender, 'TRANSFER_SENT'],
      [recipient, 'TRANSFER_RECEIVED'],
    ] as const) {
      const activity = await eventually(
        async () =>
          (await api<Activity[]>('/activity?limit=100', owner.token)).body,
        (rows) =>
          rows.some(
            (a) => a.payload.transferId === result.id && a.type === type,
          ),
        'transfer activity',
      );
      expect(
        activity
          .filter((a) => a.payload.transferId === result.id)
          .map((a) => a.type),
      ).toEqual([type]);
    }
    await reconcile(adminToken);
  });

  it('releases a real hold when confirmation rejects a frozen recipient', async () => {
    const sender = await user();
    const recipient = await user();
    const from = await wallet(sender, 'USD', 100);
    const to = await wallet(recipient, 'EUR');
    await api(`/admin/wallets/${to.id}/freeze`, adminToken, {});
    const result = await terminal(
      sender,
      (await send(sender, from, recipient, 10, 'EUR')).body.id,
    );
    expect(result).toMatchObject({
      status: 'FAILED',
      step: 'RELEASE_HOLD',
      failureReason: 'RECIPIENT_FROZEN',
    });
    const log = await events(adminToken, from.id);
    const transferEvents = log.filter(
      (e) => e.metadata.transferId === result.id,
    );
    expect(transferEvents.map((e) => e.type)).toEqual([
      'TransferInitiated',
      'HoldPlaced',
      'HoldReleased',
      'TransferFailed',
    ]);
    expect(transferEvents[3].payload.reason).toBe('RECIPIENT_FROZEN');
    const current = await readWallet(sender, from.id);
    assertBalance(current, 10000n);
    assertBalance(await readWallet(recipient, to.id), 0n);
    assertEventBalances(log, current);
    expect(
      (await events(adminToken, to.id)).some(
        (e) => e.type === 'TransferCompleted',
      ),
    ).toBe(false);
    const activity = await eventually(
      async () =>
        (await api<Activity[]>('/activity?limit=100', sender.token)).body,
      (rows) => rows.some((a) => a.payload.transferId === result.id),
      'failed transfer activity',
    );
    expect(
      activity
        .filter((a) => a.payload.transferId === result.id)
        .map((a) => a.type),
    ).toEqual(['TRANSFER_FAILED']);
    expect(
      (
        await api<Activity[]>('/activity?limit=100', recipient.token)
      ).body.filter((a) => a.payload.transferId === result.id),
    ).toEqual([]);
    await reconcile(adminToken);
  });

  it('commits one transfer and one debit for twenty concurrent identical requests', async () => {
    const sender = await user();
    const recipient = await user();
    const from = await wallet(sender, 'USD', 100);
    const to = await wallet(recipient, 'USD');
    const key = randomUUID();
    const replies = await Promise.all(
      Array.from({ length: 20 }, () =>
        send(sender, from, recipient, 10, 'USD', key),
      ),
    );
    expect(replies.filter((r) => r.status === 202)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 200)).toHaveLength(19);
    expect(new Set(replies.map((r) => r.body.id)).size).toBe(1);
    const result = await terminal(sender, replies[0].body.id);
    expect(result.status).toBe('COMPLETED');
    expect(
      (await api<Transfer[]>('/transfers?limit=100', sender.token)).body.map(
        (t) => t.id,
      ),
    ).toEqual([result.id]);
    const current = await readWallet(sender, from.id);
    assertBalance(current, 9000n);
    assertBalance(await readWallet(recipient, to.id), 1000n);
    const log = await events(adminToken, from.id);
    expect(log.filter((e) => e.type === 'HoldPlaced')).toHaveLength(1);
    expect(log.filter((e) => e.type === 'TransferCompleted')).toHaveLength(1);
    assertEventBalances(log, current);
    await reconcile(adminToken);
  });

  it('reconciles a reproducible random sequence across three currencies', async () => {
    let seed = 0x5eed;
    const random = (n: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed >>> 16) % n;
    };
    const owners = [await user(), await user()];
    const currencies: Currency[] = ['USD', 'EUR', 'UAH'];
    const accounts = [];
    for (const owner of owners) {
      for (const currency of currencies) {
        accounts.push({
          owner,
          wallet: await wallet(owner, currency, 100),
          expected: 10000n,
        });
      }
    }
    const operations = accounts.flatMap((source) =>
      Array.from({ length: 6 }, (_, i) => ({ source, type: i % 3 })),
    );
    for (let i = operations.length - 1; i > 0; i--) {
      const j = random(i + 1);
      [operations[i], operations[j]] = [operations[j], operations[i]];
    }
    const coverage = new Set<string>();
    for (const { source, type } of operations) {
      coverage.add(`${source.wallet.id}:${type}`);
      const cents = BigInt(1 + random(499));
      const amount = Number(cents) / 100;
      switch (type) {
        case 0:
          await money(source.owner, source.wallet.id, 'deposit', amount);
          source.expected += cents;
          break;
        case 1:
          await money(source.owner, source.wallet.id, 'withdraw', amount);
          source.expected -= cents;
          break;
        default: {
          const target = accounts.find(
            (a) =>
              a.owner !== source.owner &&
              a.wallet.currency === source.wallet.currency,
          )!;
          const result = await terminal(
            source.owner,
            (await send(source.owner, source.wallet, target.owner, amount)).body
              .id,
          );
          expect(result.status).toBe('COMPLETED');
          source.expected -= cents;
          target.expected += cents;
        }
      }
    }
    expect(coverage.size).toBe(accounts.length * 3);
    const allEvents = new Map<string, LedgerEvent>();
    for (const account of accounts) {
      const current = await readWallet(account.owner, account.wallet.id);
      assertBalance(current, account.expected);
      const log = await events(adminToken, current.id);
      assertEventBalances(log, current);
      log.forEach((e) => allEvents.set(e.eventId, e));
    }
    for (const type of [
      'MoneyDeposited',
      'MoneyWithdrawn',
      'TransferCompleted',
    ]) {
      expect(
        [...allEvents.values()].filter((e) => e.type === type).length,
      ).toBeGreaterThan(0);
    }
    const result = await reconcile(adminToken);
    expect(result.perCurrency.map((c) => c.currency)).toEqual(
      expect.arrayContaining(currencies),
    );
  });

  it('honors the WS and REST contract after a transport reconnect', async () => {
    const owner = await user();
    const w = await wallet(owner, 'USD');
    const socket = io(
      `${process.env.WS_PUBLIC_URL ?? 'http://localhost:3003'}/ws`,
      {
        auth: { token: owner.token },
        autoConnect: false,
        reconnection: false,
        transports: ['websocket'],
        timeout: 10000,
      },
    );
    const snapshots: Wallet[] = [];
    const pushes: { walletId: string; balance: string }[] = [];
    const errors: Error[] = [];
    socket.on('connect_error', (error) => errors.push(error));
    socket.on('connect', () => {
      void readWallet(owner, w.id)
        .then((value) => snapshots.push(value))
        .catch((error) => errors.push(error));
    });
    socket.on('wallet.balance', (value) => pushes.push(value));
    try {
      socket.connect();
      await eventually(
        async () => snapshots.length,
        (n) => n === 1 || errors.length > 0,
        'initial connect',
      );
      expect(errors).toEqual([]);
      await money(owner, w.id, 'deposit', 1.23);
      await eventually(
        async () => pushes,
        (rows) => rows.some((p) => p.walletId === w.id && p.balance === '1.23'),
        'live balance',
      );
      socket.io.engine.close();
      expect(socket.connected).toBe(false);
      await money(owner, w.id, 'deposit', 0.29);
      await eventually(
        async () =>
          (
            await api<Activity[]>(
              '/activity?type=DEPOSIT&limit=100',
              owner.token,
            )
          ).body,
        (rows) => rows.length === 2,
        'offline event consumed',
      );
      expect(pushes.some((p) => p.balance === '1.52')).toBe(false);
      socket.connect();
      await eventually(
        async () => snapshots.length,
        (n) => n === 2 || errors.length > 0,
        'reconnect REST',
      );
      expect(errors).toEqual([]);
      assertBalance(snapshots[1], 152n);
      expect(minor(snapshots[1].balance)).toBeGreaterThan(
        minor(snapshots[0].balance),
      );
      await money(owner, w.id, 'deposit', 0.01);
      await eventually(
        async () => pushes,
        (rows) => rows.some((p) => p.walletId === w.id && p.balance === '1.53'),
        'live balance after reconnect',
      );
      await reconcile(adminToken);
    } finally {
      socket.disconnect();
      socket.removeAllListeners();
    }
  });
});
