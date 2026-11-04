import { randomUUID } from 'crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';

interface FakeWallet {
  walletId: string;
  ownerId: string;
  currency: string;
  frozen: boolean;
  available: bigint;
  held: bigint;
}

interface FakeHold {
  holdId: string;
  walletId: string;
  amountMinor: bigint;
  status: 'ACTIVE' | 'RELEASED' | 'CAPTURED';
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
  }
}

const conflict = (code: string) => new HttpError(409, { code, message: code });
const notFound = () => new HttpError(404, { code: 'NOT_FOUND', message: 'NOT_FOUND' });

// Тестовий двійник internal API ledger-service (той самий контракт,
// що реалізує ledger): гаманці, холди, ідемпотентність за operationId.
// Справжній ledger у тестах payments не піднімаємо — у кожного сервісу своя БД.
export class FakeLedger {
  readonly users = new Map<string, string>(); // email → userId
  readonly wallets = new Map<string, FakeWallet>();
  readonly holds = new Map<string, FakeHold>();
  readonly calls: string[] = [];
  private readonly operations = new Map<string, unknown>();
  private readonly releasedBeforePlaced = new Set<string>();
  // true — відповідає 503 на все (ledger «лежить»).
  down = false;
  // 503 лише на шляхи, що збігаються (недоступна частина ledger).
  downPath: RegExp | null = null;
  private server?: Server;

  constructor(private readonly token: string) {}

  start(port: number): Promise<void> {
    this.server = createServer((req, res) => this.handle(req, res));
    return new Promise((resolve) => this.server!.listen(port, resolve));
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server!.close(() => resolve()));
  }

  addUser(email = `${randomUUID()}@example.com`) {
    const userId = randomUUID();
    this.users.set(email, userId);
    return { userId, email };
  }

  addWallet(ownerId: string, currency: string, availableMinor = 0n) {
    const wallet: FakeWallet = {
      walletId: randomUUID(),
      ownerId,
      currency,
      frozen: false,
      available: availableMinor,
      held: 0n,
    };
    this.wallets.set(wallet.walletId, wallet);
    return wallet;
  }

  walletOf(ownerId: string, currency: string) {
    return [...this.wallets.values()].find(
      (w) => w.ownerId === ownerId && w.currency === currency,
    );
  }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
    const path = decodeURIComponent(req.url ?? '');
    this.calls.push(`${req.method} ${path}`);
    try {
      if (this.down || this.downPath?.test(path)) {
        throw new HttpError(503, { message: 'down' });
      }
      if (req.headers['x-internal-token'] !== this.token) {
        throw new HttpError(401, { message: 'Unauthorized' });
      }
      const result = this.route(req.method ?? '', path, body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (error) {
      const { status, body: errorBody } =
        error instanceof HttpError ? error : new HttpError(500, { message: String(error) });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(errorBody));
    }
  }

  private route(method: string, path: string, body: Record<string, string>) {
    let match: RegExpExecArray | null;
    if (method === 'GET' && (match = /^\/internal\/users\/by-email\/(.+)$/.exec(path))) {
      const userId = this.users.get(match[1]);
      if (!userId) throw notFound();
      return { userId, email: match[1] };
    }
    if (method === 'POST' && path === '/internal/wallets/ensure') {
      const wallet =
        this.walletOf(body.userId, body.currency) ??
        this.addWallet(body.userId, body.currency);
      return this.ref(wallet);
    }
    if (method === 'GET' && (match = /^\/internal\/wallets\/(.+)$/.exec(path))) {
      const wallet = this.wallets.get(match[1]);
      if (!wallet) throw notFound();
      return {
        ...this.ref(wallet),
        available: wallet.available.toString(),
        held: wallet.held.toString(),
      };
    }
    if (method === 'POST' && path === '/internal/holds') {
      // Як ledger: відмову place (409) запам'ятовано під operationId.
      return this.once(body.operationId, () => this.place(body), true);
    }
    if (method === 'POST' && (match = /^\/internal\/holds\/(.+)\/release$/.exec(path))) {
      const holdId = match[1];
      return this.once(body.operationId, () => this.release(holdId, body.walletId));
    }
    if (method === 'POST' && (match = /^\/internal\/holds\/(.+)\/capture$/.exec(path))) {
      const holdId = match[1];
      return this.once(body.operationId, () => this.capture(holdId, body));
    }
    if (method === 'GET' && (match = /^\/internal\/holds\/(.+)$/.exec(path))) {
      const hold = this.holds.get(match[1]);
      if (!hold) throw notFound();
      return { holdId: hold.holdId, status: hold.status };
    }
    throw new HttpError(404, { message: `no route ${method} ${path}` });
  }

  private ref(wallet: FakeWallet) {
    return {
      walletId: wallet.walletId,
      ownerId: wallet.ownerId,
      currency: wallet.currency,
      frozen: wallet.frozen,
    };
  }

  private once(operationId: string, run: () => unknown, keepRejection = false) {
    if (!this.operations.has(operationId)) {
      try {
        this.operations.set(operationId, run());
      } catch (error) {
        if (keepRejection && error instanceof HttpError && error.status === 409) {
          this.operations.set(operationId, error);
        }
        throw error;
      }
    }
    const result = this.operations.get(operationId);
    if (result instanceof HttpError) throw result;
    return result;
  }

  private place(body: Record<string, string>) {
    if (this.releasedBeforePlaced.has(body.holdId)) throw conflict('HOLD_NOT_ACTIVE');
    const wallet = this.wallets.get(body.walletId);
    if (!wallet) throw notFound();
    if (wallet.ownerId !== body.ownerId) throw conflict('OWNER_MISMATCH');
    if (wallet.currency !== body.currency) throw conflict('CURRENCY_MISMATCH');
    if (wallet.frozen) throw conflict('WALLET_FROZEN');
    const amount = BigInt(body.amountMinor);
    if (wallet.available < amount) throw conflict('INSUFFICIENT_FUNDS');
    wallet.available -= amount;
    wallet.held += amount;
    this.holds.set(body.holdId, {
      holdId: body.holdId,
      walletId: wallet.walletId,
      amountMinor: amount,
      status: 'ACTIVE',
    });
    return { holdId: body.holdId, status: 'ACTIVE' };
  }

  private release(holdId: string, walletId?: string) {
    const hold = this.holds.get(holdId);
    if (!hold && walletId && this.wallets.has(walletId)) {
      // Як ledger: холду ще немає — лишаємо слід, запізнілий place відхиляється.
      this.releasedBeforePlaced.add(holdId);
      return { holdId, status: 'RELEASED' };
    }
    if (!hold) throw notFound();
    if (hold.status !== 'ACTIVE') throw conflict('HOLD_NOT_ACTIVE');
    const wallet = this.wallets.get(hold.walletId)!;
    wallet.held -= hold.amountMinor;
    wallet.available += hold.amountMinor;
    hold.status = 'RELEASED';
    return { holdId, status: 'RELEASED' };
  }

  private capture(holdId: string, body: Record<string, string>) {
    const hold = this.holds.get(holdId);
    if (!hold) throw notFound();
    if (hold.status !== 'ACTIVE') throw conflict('HOLD_NOT_ACTIVE');
    const recipient = this.wallets.get(body.toWalletId);
    if (!recipient) throw notFound();
    const sender = this.wallets.get(hold.walletId)!;
    // Ті самі перевірки й порядок, що в справжньому ledger.
    if (sender.frozen) throw conflict('WALLET_FROZEN');
    if (recipient.currency !== body.toCurrency) throw conflict('CURRENCY_MISMATCH');
    if (recipient.frozen) throw conflict('RECIPIENT_FROZEN');
    const toAmount = BigInt(body.toAmountMinor);
    if (sender.currency === recipient.currency && toAmount !== hold.amountMinor) {
      throw new HttpError(400, { message: 'В одній валюті суми мають збігатись' });
    }
    // Між валютами: сума зарахування = сума холду × fxRate з точністю ±1.
    const expected = Math.round(Number(hold.amountMinor) * Number(body.fxRate));
    if (
      sender.currency !== recipient.currency &&
      Math.abs(Number(toAmount) - expected) > 1
    ) {
      throw new HttpError(400, { message: 'Сума зарахування не відповідає курсу' });
    }
    sender.held -= hold.amountMinor;
    recipient.available += BigInt(body.toAmountMinor);
    hold.status = 'CAPTURED';
    return { holdId, status: 'CAPTURED' };
  }
}
