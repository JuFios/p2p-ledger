import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Activity } from '../activity/activity.entity';
import { IntegrationEvent, mapEvent } from './event-mapper';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class EventHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gateway: NotificationsGateway,
  ) {}

  async handle(event: IntegrationEvent, position: string) {
    if (!/^\d+-\d+$/.test(position)) throw new Error('Invalid stream position');
    const [milliseconds, sequence] = position.split('-');
    const result = await this.dataSource.transaction(async (manager) => {
      const inserted: { event_id: string }[] = await manager.query(
        'INSERT INTO processed_events (event_id) VALUES ($1) ON CONFLICT DO NOTHING RETURNING event_id',
        [event.eventId],
      );
      if (!inserted.length) return null;
      const mapped = mapEvent(event);
      const activities = await manager.save(
        Activity,
        mapped.activities.map((draft) =>
          manager.create(Activity, {
            ...draft,
            eventId: event.eventId,
            createdAt: new Date(event.occurredAt),
          }),
        ),
      );
      // Усі balance-події походять з одного ledger-стріму. Час події
      // не визначає порядок: порівнюємо обидві числові частини Redis ID.
      const pushes = [];
      for (const push of [...mapped.pushes].sort((a, b) =>
        String(a.payload.walletId).localeCompare(String(b.payload.walletId)))) {
        if (push.event === 'wallet.balance') {
          const advanced: { wallet_id: string }[] = await manager.query(
            `INSERT INTO wallet_update_positions (wallet_id, milliseconds, sequence)
             VALUES ($1, $2, $3)
             ON CONFLICT (wallet_id) DO UPDATE
             SET milliseconds = EXCLUDED.milliseconds, sequence = EXCLUDED.sequence
             WHERE (wallet_update_positions.milliseconds, wallet_update_positions.sequence)
                 < (EXCLUDED.milliseconds, EXCLUDED.sequence)
             RETURNING wallet_id`,
            [push.payload.walletId, milliseconds, sequence],
          );
          if (!advanced.length) continue;
        }
        pushes.push(push);
      }
      return { pushes, activities };
    });
    if (!result) return;
    // Push відправляється після коміту. Пропущені під час збою push клієнт
    // надолужує через REST при reconnect.
    for (const activity of result.activities)
      this.gateway.emit(activity.userId, 'activity.created', activity);
    for (const push of result.pushes)
      this.gateway.emit(push.userId, push.event, push.payload);
  }
}
