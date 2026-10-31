import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/jwt.strategy';
import { toMinor } from '../common/money';
import { LedgerClient, LedgerUser } from '../ledger/ledger.client';
import { LedgerRejection, LedgerUnavailable } from '../ledger/ledger-errors';
import { OutboxMessage } from '../outbox/outbox-message.entity';
import { CreateSplitBillDto } from './dto/create-split-bill.dto';
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
  ) {}

  // Учасники — користувачі ledger за email. Ініціатор учасником бути не може:
  // його частка — це переказ самому собі, а такі переказ відхиляє.
  async create(user: AuthUser, dto: CreateSplitBillDto): Promise<SplitBillView> {
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dueAt && dueAt.getTime() <= Date.now()) {
      throw badRequest('DUE_DATE_IN_PAST', 'dueAt має бути в майбутньому');
    }
    const totalMinor = toMinor(dto.totalAmount);
    const customAmounts = this.customAmounts(dto, totalMinor);

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
    const amounts =
      customAmounts ?? splitEqually(totalMinor, users.length);
    if (!amounts) {
      throw badRequest(
        'SHARE_TOO_SMALL',
        'Сума рахунку замала, щоб розділити її між учасниками',
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
