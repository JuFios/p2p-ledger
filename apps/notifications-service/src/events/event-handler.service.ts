import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Activity } from '../activity/activity.entity';
import { IntegrationEvent, mapEvent, Push } from './event-mapper';
import { NotificationsGateway } from './notifications.gateway';

@Injectable()
export class EventHandler {
  constructor(
    private readonly dataSource: DataSource,
    private readonly gateway: NotificationsGateway,
  ) {}

  async handle(event: IntegrationEvent) {
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
      // Позиція належить події продюсера й не змінюється після повторного XADD.
      // Старі конверти без позиції зберігаємо у стрічці без застарілих state push.
      const pushes: Push[] = [];
      const advanced = new Map<string, boolean>();
      // Стабільний порядок оновлення маркерів запобігає взаємним блокуванням.
      const candidates = mapped.pushes
        .map((push) => ({
          push,
          resourceId: String(push.payload.walletId ?? push.payload.transferId),
        }))
        .sort((a, b) => a.resourceId.localeCompare(b.resourceId));
      for (const { push, resourceId } of candidates) {
        if (!event.position) continue;
        const key = `${push.event}:${resourceId}`;
        if (!advanced.has(key)) {
          const rows: { resource_id: string }[] = await manager.query(
            `INSERT INTO push_update_positions (producer, event, resource_id, position)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (producer, event, resource_id) DO UPDATE
             SET position = EXCLUDED.position
             WHERE push_update_positions.position < EXCLUDED.position
             RETURNING resource_id`,
            [event.producer, push.event, resourceId, event.position],
          );
          advanced.set(key, rows.length > 0);
        }
        if (advanced.get(key)) pushes.push(push);
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
