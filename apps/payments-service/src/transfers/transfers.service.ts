import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { toMinor } from '../common/money';
import { assertSameRequest, hashRequest } from '../common/request-hash';
import { currentTraceparent } from '../common/tracing';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Transfer } from './entities/transfer.entity';
import { transferStatusChanged } from './transfer-events';
import { toTransferView, TransferView } from './transfer-view';

// Параметри нового переказу після валідації; сума вже в мінорних одиницях.
export interface NewTransfer {
  fromWalletId: string;
  recipientEmail: string;
  amountMinor: string;
  currency: string;
  toCurrency: string;
  // Переказ — оплата частки split-рахунку.
  splitShareId?: string;
}

export interface CreateTransferResult {
  created: boolean;
  transfer: TransferView;
}

@Injectable()
export class TransfersService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    user: AuthUser,
    idempotencyKey: string,
    dto: CreateTransferDto,
  ): Promise<CreateTransferResult> {
    return this.dataSource.transaction((manager) =>
      this.insert(manager, user, idempotencyKey, {
        fromWalletId: dto.fromWalletId,
        recipientEmail: dto.toWalletIdentifier,
        amountMinor: toMinor(dto.amount).toString(),
        currency: dto.currency,
        toCurrency: dto.toCurrency ?? dto.currency,
      }),
    );
  }

  // Створює переказ у статусі PENDING; далі його веде saga runner.
  // Ідемпотентність: UNIQUE(sender_user_id, idempotency_key) +
  // INSERT … ON CONFLICT DO NOTHING. Паралельний дубль чекає на коміт
  // першого запиту й читає вже створений переказ — другого не буде.
  // Виконується в транзакції викликача: оплата частки split-рахунку
  // додає до неї перехід частки.
  async insert(
    manager: EntityManager,
    user: AuthUser,
    idempotencyKey: string,
    params: NewTransfer,
  ): Promise<CreateTransferResult> {
    const requestHash = this.hashOf(params);
    const inserted = await manager
      .createQueryBuilder()
      .insert()
      .into(Transfer)
      .values({
        id: randomUUID(),
        senderUserId: user.userId,
        senderEmail: user.email,
        idempotencyKey,
        requestHash,
        fromWalletId: params.fromWalletId,
        recipientEmail: params.recipientEmail,
        amountMinor: params.amountMinor,
        currency: params.currency,
        toCurrency: params.toCurrency,
        splitShareId: params.splitShareId ?? null,
        status: 'PENDING',
        step: 'RISK_CHECK',
        attempts: 0,
        nextAttemptAt: () => 'now()',
        traceparent: currentTraceparent(),
      })
      .orIgnore()
      .returning('id')
      .execute();

    if (inserted.raw.length > 0) {
      const transfer = await manager.findOneByOrFail(Transfer, {
        id: inserted.raw[0].id,
      });
      await manager.save(OutboxMessage, transferStatusChanged(transfer));
      return { created: true, transfer: toTransferView(transfer) };
    }

    const existing = await manager.findOneByOrFail(Transfer, {
      senderUserId: user.userId,
      idempotencyKey,
    });
    return this.replay(existing, requestHash);
  }

  // Повтор запиту, який уже виконано: переказ за (відправник, ключ), якщо він
  // є. Не вимагає ні ledger, ні блокувань. Той самий ключ з іншими
  // параметрами — 422.
  async findReplay(
    manager: EntityManager,
    userId: string,
    idempotencyKey: string,
    params: NewTransfer,
  ): Promise<CreateTransferResult | null> {
    const existing = await manager.findOneBy(Transfer, {
      senderUserId: userId,
      idempotencyKey,
    });
    return existing ? this.replay(existing, this.hashOf(params)) : null;
  }

  private replay(existing: Transfer, requestHash: string): CreateTransferResult {
    assertSameRequest(existing.requestHash, requestHash);
    return { created: false, transfer: toTransferView(existing) };
  }

  private hashOf(params: NewTransfer): string {
    return hashRequest({
      fromWalletId: params.fromWalletId,
      toWalletIdentifier: params.recipientEmail,
      amountMinor: params.amountMinor,
      currency: params.currency,
      toCurrency: params.toCurrency,
      ...(params.splitShareId ? { splitShareId: params.splitShareId } : {}),
    });
  }

  // Відправник бачить переказ завжди, отримувач — лише після зарахування
  // (невдалий чи незавершений переказ його не стосується); іншим — 404,
  // як і неіснуючий.
  async getForUser(userId: string, id: string): Promise<TransferView> {
    const transfer = await this.dataSource.manager.findOne(Transfer, {
      where: [
        { id, senderUserId: userId },
        { id, recipientUserId: userId, status: 'COMPLETED' },
      ],
    });
    if (!transfer) {
      throw new NotFoundException('Переказ не знайдено');
    }
    return toTransferView(transfer);
  }

  async listForUser(userId: string, limit = 20): Promise<TransferView[]> {
    const transfers = await this.dataSource.manager.find(Transfer, {
      where: [
        { senderUserId: userId },
        { recipientUserId: userId, status: 'COMPLETED' },
      ],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return transfers.map(toTransferView);
  }
}
