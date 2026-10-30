import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager } from 'typeorm';
import {
  CURRENT_SCHEMA_VERSION,
  EventMetadata,
  MONEY_EVENT_TYPES,
  postingsOf,
} from './domain/events';
import { assertBalanced } from './domain/postings';
import { StoredEvent } from './entities/stored-event.entity';
import { PostingEntry } from './entities/posting.entity';

export interface NewEvent {
  type: string;
  payload: Record<string, unknown>;
  metadata: EventMetadata;
}

export interface RecordedEvent extends NewEvent {
  eventId: string;
  streamVersion: number;
  globalPosition: string;
}

// Append-only сховище подій на Postgres. Працює в транзакції викликача:
// подія, її проводки, проєкції, outbox і operations комітяться разом.
@Injectable()
export class EventStore {
  async streamVersion(
    manager: EntityManager,
    streamId: string,
  ): Promise<number> {
    const [{ version }] = await manager.query(
      `SELECT COALESCE(MAX(stream_version), 0)::int AS version
       FROM events WHERE stream_id = $1`,
      [streamId],
    );
    return version;
  }

  // Паралельний запис з тією самою expectedVersion впаде на
  // UNIQUE(stream_id, stream_version) — оптимістична конкурентність.
  async append(
    manager: EntityManager,
    streamId: string,
    expectedVersion: number,
    events: NewEvent[],
  ): Promise<RecordedEvent[]> {
    const recorded: RecordedEvent[] = [];
    for (const [i, event] of events.entries()) {
      const postings = postingsOf(event.payload);
      // Незбалансовані або відсутні в грошовій події проводки → exception →
      // транзакція не комітиться.
      if (postings.length > 0 || MONEY_EVENT_TYPES.has(event.type)) {
        assertBalanced(postings);
      }
      const eventId = randomUUID();
      const streamVersion = expectedVersion + i + 1;
      const result = await manager.insert(StoredEvent, {
        eventId,
        streamId,
        streamVersion,
        eventType: event.type,
        schemaVersion: CURRENT_SCHEMA_VERSION[event.type],
        payload: event.payload,
        metadata: event.metadata,
      });
      if (postings.length > 0) {
        await manager.insert(
          PostingEntry,
          postings.map((p) => ({
            eventId,
            operationId: event.metadata.operationId,
            ...p,
          })),
        );
      }
      recorded.push({
        ...event,
        eventId,
        streamVersion,
        globalPosition: result.identifiers[0].globalPosition,
      });
    }
    return recorded;
  }
}
