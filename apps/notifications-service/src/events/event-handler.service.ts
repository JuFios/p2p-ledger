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
      return { ...mapped, activities };
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
