import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1793534400000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE processed_events (event_id uuid PRIMARY KEY)`,
    );
    await queryRunner.query(`CREATE TABLE activity (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL,
      user_id uuid NOT NULL, type varchar NOT NULL, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_user_created" ON activity (user_id, created_at)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_activity_user_type" ON activity (user_id, type)`,
    );
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE activity');
    await queryRunner.query('DROP TABLE processed_events');
  }
}
