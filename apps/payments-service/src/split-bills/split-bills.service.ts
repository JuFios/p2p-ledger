import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { blockedEmails } from '../common/blocked-emails';
import { toMinor } from '../common/money';
import { LedgerClient, LedgerUser } from '../ledger/ledger.client';
import { LedgerRejection, LedgerUnavailable } from '../ledger/ledger-errors';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import {
  CreateTransferResult,
  TransfersService,
} from '../transfers/transfers.service';
import { CreateSplitBillDto } from './dto/create-split-bill.dto';
import { PayShareDto } from './dto/pay-share.dto';
import { SplitBill } from './entities/split-bill.entity';
import { SplitShare } from './entities/split-share.entity';
import { splitBillCreated } from './split-events';
import { splitEqually } from './split-math';
import { SplitBillView, toSplitBillView } from './split-bill-view';

const badRequest = (code: string, message: string) =>
  new BadRequestException({ code, message });

@Injectable()
export class SplitBillsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly ledger: LedgerClient,
    private readonly transfers: TransfersService,
    private readonly config: ConfigService,
  ) {}

  // Учасники — користувачі ledger за email. Ініціатор учасником бути не може:
  // його частка — це переказ самому собі, а такі переказ відхиляє.
  async create(user: AuthUser, dto: CreateSplitBillDto): Promise<SplitBillView> {
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    // Тижневий, порядковий і базовий формати ISO 8601 валідатор пропускає,
    // а Date їх не розбирає.
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      throw badRequest(
        'INVALID_DUE_DATE',
        'dueAt: дата або дата-час ISO 8601 (YYYY-MM-DD, YYYY-MM-DDTHH:mm:ssZ)',
      );
    }
    if (dueAt && dueAt.getTime() <= Date.now()) {
      throw badRequest('DUE_DATE_IN_PAST', 'dueAt має бути в майбутньому');
    }
    const totalMinor = toMinor(dto.totalAmount);
    const amounts =
      this.customAmounts(dto, totalMinor) ??
      splitEqually(totalMinor, dto.participants.length);
    if (!amounts) {
      throw badRequest(
        'SHARE_TOO_SMALL',
        'Сума рахунку замала, щоб розділити її між учасниками',
      );
    }
    this.assertPayable(user.email, dto, amounts);

    const users = await Promise.all(
      dto.participants.map((participant) => this.resolveUser(participant.email)),
    );
    const userIds = new Set(users.map((participant) => participant.userId));
    if (userIds.size !== users.length) {
      throw badRequest('DUPLICATE_PARTICIPANT', 'Учасники не повинні повторюватись');
    }
    if (userIds.has(user.userId)) {
      throw badRequest(
        'SELF_PARTICIPANT',
        'Ініціатор не може бути учасником власного рахунку',
      );
    }
    return this.dataSource.transaction(async (manager) => {
      const bill = await manager.save(
        manager.create(SplitBill, {
          id: randomUUID(),
          creatorUserId: user.userId,
          creatorEmail: user.email,
          title: dto.title,
          totalMinor: totalMinor.toString(),
          currency: dto.currency,
          mode: dto.mode,
          dueAt,
        }),
      );
      const shares = await manager.save(
        users.map((participant, index) =>
          manager.create(SplitShare, {
            id: randomUUID(),
            billId: bill.id,
            position: index,
            participantUserId: participant.userId,
            participantEmail: participant.email,
            amountMinor: amounts[index].toString(),
            status: 'PENDING',
          }),
        ),
      );
      await manager.save(OutboxMessage, splitBillCreated(bill, shares));
      bill.shares = shares;
      return toSplitBillView(bill);
    });
  }

  // Рахунок бачать ініціатор і учасники, іншим — 404.
  async getForUser(
    userId: string,
    id: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<SplitBillView> {
    const bill = await this.visibleBills(manager, userId)
      .andWhere('bill.id = :id', { id })
      .getOne();
    if (!bill) {
      throw new NotFoundException('Рахунок не знайдено');
    }
    return toSplitBillView(bill);
  }

  async listForUser(userId: string, limit = 20): Promise<SplitBillView[]> {
    const ids = await this.dataSource.manager
      .createQueryBuilder(SplitBill, 'bill')
      .select('bill.id')
      .where(this.visibleTo, { userId })
      .orderBy('bill.createdAt', 'DESC')
      .limit(limit)
      .getMany();
    if (ids.length === 0) return [];
    const bills = await this.visibleBills(this.dataSource.manager, userId)
      .andWhere('bill.id IN (:...ids)', { ids: ids.map((bill) => bill.id) })
      .getMany();
    return bills.map(toSplitBillView);
  }

  // Учасник підтверджує свою частку: PENDING → ACCEPTED. Перехід — умовним
  // UPDATE, тож повторне підтвердження не проходить непомітно.
  async accept(
    userId: string,
    billId: string,
    shareId: string,
  ): Promise<SplitBillView> {
    await this.findOwnShare(this.dataSource.manager, userId, billId, shareId);
    const result = await this.dataSource.manager.update(
      SplitShare,
      { id: shareId, status: 'PENDING' },
      { status: 'ACCEPTED' },
    );
    if (result.affected !== 1) {
      throw new ConflictException({
        code: 'INVALID_SHARE_STATUS',
        message: 'Частку вже підтверджено або сплачено',
      });
    }
    return this.getForUser(userId, billId);
  }

  // Сплата частки: переказ на email ініціатора тією самою сагою, у валюті
  // рахунку. Переказ і перехід ACCEPTED → PAYING — одна транзакція. Переказ
  // вставляється першим: паралельний дубль з тим самим ключем отримає той
  // самий переказ (ON CONFLICT), а другий запит з іншим ключем програє
  // умовному UPDATE частки → 409, і його переказ відкочується.
  async pay(
    user: AuthUser,
    idempotencyKey: string,
    billId: string,
    shareId: string,
    dto: PayShareDto,
  ): Promise<CreateTransferResult> {
    const share = await this.findOwnShare(
      this.dataSource.manager,
      user.userId,
      billId,
      shareId,
    );
    await this.checkWallet(user.userId, dto.fromWalletId, share.bill.currency);

    return this.dataSource.transaction(async (manager) => {
      const result = await this.transfers.insert(manager, user, idempotencyKey, {
        fromWalletId: dto.fromWalletId,
        recipientEmail: share.bill.creatorEmail,
        amountMinor: share.amountMinor,
        currency: share.bill.currency,
        toCurrency: share.bill.currency,
        splitShareId: share.id,
      });
      if (!result.created) return result;

      const claimed = await manager.update(
        SplitShare,
        { id: share.id, status: 'ACCEPTED' },
        { status: 'PAYING' },
      );
      if (claimed.affected !== 1) {
        const current = await manager.findOneByOrFail(SplitShare, { id: share.id });
        throw new ConflictException({
          code: 'INVALID_SHARE_STATUS',
          message:
            current.status === 'PENDING'
              ? 'Спочатку підтвердіть частку (accept)'
              : `Частку не можна сплатити: статус ${current.status}`,
        });
      }
      return result;
    });
  }

  // Частка учасника в рахунку; чужа частка чи чужий рахунок → 404.
  async findOwnShare(
    manager: EntityManager,
    userId: string,
    billId: string,
    shareId: string,
  ): Promise<SplitShare & { bill: SplitBill }> {
    const share = await manager.findOne(SplitShare, {
      where: { id: shareId, billId, participantUserId: userId },
      relations: { bill: true },
    });
    if (!share) {
      throw new NotFoundException('Частку не знайдено');
    }
    return share;
  }

  private readonly visibleTo = `(bill.creator_user_id = :userId OR bill.id IN (
    SELECT bill_id FROM split_shares WHERE participant_user_id = :userId))`;

  private visibleBills(manager: EntityManager, userId: string) {
    return manager
      .createQueryBuilder(SplitBill, 'bill')
      .leftJoinAndSelect('bill.shares', 'share')
      .where(this.visibleTo, { userId })
      .orderBy('bill.createdAt', 'DESC')
      .addOrderBy('share.position', 'ASC');
  }

  // Частку, яку сага однаково відхилить (понад ліміт переказу, чорний
  // список), не створюємо: її не вдалося б сплатити, а рахунок ніколи б не
  // став SETTLED.
  private assertPayable(
    creatorEmail: string,
    dto: CreateSplitBillDto,
    amounts: bigint[],
  ) {
    const max = toMinor(this.config.getOrThrow<number>('TRANSFER_MAX_AMOUNT'));
    if (amounts.some((amount) => amount > max)) {
      throw badRequest(
        'SHARE_LIMIT_EXCEEDED',
        'Частка перевищує ліміт одного переказу',
      );
    }
    const blocked = blockedEmails(this.config);
    const emails = [creatorEmail, ...dto.participants.map((p) => p.email)];
    if (emails.some((email) => blocked.has(email.toLowerCase()))) {
      throw badRequest(
        'BLOCKED_PARTICIPANT',
        'Ініціатор або учасник у чорному списку: частки не можна сплатити',
      );
    }
  }

  // CUSTOM: кожен учасник має суму, разом — рівно totalAmount. EQUAL: сум немає.
  private customAmounts(dto: CreateSplitBillDto, totalMinor: bigint) {
    const given = dto.participants.map((participant) => participant.amount);
    if (dto.mode === 'EQUAL') {
      if (given.some((amount) => amount !== undefined)) {
        throw badRequest(
          'AMOUNT_NOT_ALLOWED',
          'У режимі EQUAL суми учасників не задаються',
        );
      }
      return null;
    }
    if (given.some((amount) => amount === undefined)) {
      throw badRequest('AMOUNT_REQUIRED', 'У режимі CUSTOM потрібна сума кожного учасника');
    }
    const amounts = given.map((amount) => toMinor(amount as number));
    if (amounts.reduce((sum, amount) => sum + amount, 0n) !== totalMinor) {
      throw badRequest(
        'SHARES_SUM_MISMATCH',
        'Сума часток має дорівнювати загальній сумі рахунку',
      );
    }
    return amounts;
  }

  // Гаманець має належати платнику й бути у валюті рахунку. Чужий гаманець
  // виглядає як неіснуючий.
  private async checkWallet(userId: string, walletId: string, currency: string) {
    let wallet;
    try {
      wallet = await this.ledger.getWallet(walletId);
    } catch (error) {
      if (error instanceof LedgerRejection && error.code === 'NOT_FOUND') {
        throw new NotFoundException('Гаманець не знайдено');
      }
      if (error instanceof LedgerUnavailable) {
        throw new ServiceUnavailableException('Ledger тимчасово недоступний');
      }
      throw error;
    }
    if (wallet.ownerId !== userId) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    if (wallet.currency !== currency) {
      throw badRequest(
        'CURRENCY_MISMATCH',
        `Частку сплачують з гаманця у валюті рахунку (${currency})`,
      );
    }
  }

  private async resolveUser(email: string): Promise<LedgerUser> {
    try {
      return await this.ledger.findUserByEmail(email);
    } catch (error) {
      if (error instanceof LedgerRejection && error.code === 'NOT_FOUND') {
        throw badRequest('PARTICIPANT_NOT_FOUND', `Користувача ${email} не знайдено`);
      }
      if (error instanceof LedgerUnavailable) {
        throw new ServiceUnavailableException('Ledger тимчасово недоступний');
      }
      throw error;
    }
  }
}
