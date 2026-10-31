import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

// Виконані команди ledger: ключ ідемпотентності й збережений результат.
@Entity('operations')
export class Operation {
  @PrimaryColumn({ name: 'operation_id' })
  operationId: string;

  @Column()
  type: string;

  @Column({ name: 'request_hash' })
  requestHash: string;

  @Column({ type: 'jsonb' })
  result: unknown;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
