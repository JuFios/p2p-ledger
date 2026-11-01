import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('push_update_positions')
export class PushUpdatePosition {
  @PrimaryColumn({ type: 'varchar' }) producer: string;
  @PrimaryColumn({ type: 'varchar' }) event: string;
  @PrimaryColumn({ name: 'resource_id', type: 'uuid' }) resourceId: string;
  @Column({ type: 'numeric', precision: 20, scale: 0 }) position: string;
}
