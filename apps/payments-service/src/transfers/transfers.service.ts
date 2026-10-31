import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { toMinor } from '../common/money';
import { hashRequest } from '../common/request-hash';
import { currentTraceparent } from '../common/tracing';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { Transfer } from './entities/transfer.entity';
import { transferStatusChanged } from './transfer-events';
import { toTransferView, TransferView } from './transfer-view';

export interface CreateTransferResult {
  created: boolean;
  transfer: TransferView;
}

@Injectable()
export class TransfersService {
  constructor(private readonly dataSource: DataSource) {}

  // Створює переказ у статусі PENDING; далі його веде saga runner.
  // Ідемпотентність: UNIQUE(sender_user_id, idempotency_key) +
  // INSERT … ON CONFLICT DO NOTHING. Паралельний дубль чекає на коміт
  // першого запиту й читає вже створений переказ — другого не буде.
  async create(
    user: AuthUser,
    idempotencyKey: string,
    dto: CreateTransferDto,
  ): Promise<CreateTransferResult> {
    const amountMinor = toMinor(dto.amount).toString();
    const toCurrency = dto.toCurrency ?? dto.currency;
    const requestHash = hashRequest({
      fromWalletId: dto.fromWalletId,
      toWalletIdentifier: dto.toWalletIdentifier,
      amountMinor,
      currency: dto.currency,
      toCurrency,
    });
    return this.dataSource.transaction(async (manager) => {
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
          fromWalletId: dto.fromWalletId,
          recipientEmail: dto.toWalletIdentifier,
          amountMinor,
          currency: dto.currency,
          toCurrency,
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
      if (existing.requestHash !== requestHash) {
        throw new UnprocessableEntityException({
          code: 'IDEMPOTENCY_KEY_REUSED',
          message: 'Ключ ідемпотентності вже використано з іншими параметрами',
        });
      }
      return { created: false, transfer: toTransferView(existing) };
    });
  }

  // Переказ бачать лише відправник і отримувач; іншим — 404, як і неіснуючий.
  async getForUser(userId: string, id: string): Promise<TransferView> {
    const transfer = await this.dataSource.manager.findOne(Transfer, {
      where: [
        { id, senderUserId: userId },
        { id, recipientUserId: userId },
      ],
    });
    if (!transfer) {
      throw new NotFoundException('Переказ не знайдено');
    }
    return toTransferView(transfer);
  }

  async listForUser(userId: string, limit = 20): Promise<TransferView[]> {
    const transfers = await this.dataSource.manager.find(Transfer, {
      where: [{ senderUserId: userId }, { recipientUserId: userId }],
      order: { createdAt: 'DESC' },
      take: limit,
    });
    return transfers.map(toTransferView);
  }
}
