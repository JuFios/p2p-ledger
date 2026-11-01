import { MigrationInterface, QueryRunner } from 'typeorm';

export class StablePushPositions1793541600000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE push_update_positions (
      producer varchar NOT NULL, event varchar NOT NULL, resource_id uuid NOT NULL,
      position numeric(20,0) NOT NULL,
      PRIMARY KEY (producer, event, resource_id)
    )`);
    // Redis ID неможливо перетворити на позицію outbox без даних продюсера.
    await queryRunner.query('DROP TABLE wallet_update_positions');
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE wallet_update_positions (
      wallet_id uuid PRIMARY KEY, milliseconds numeric(20,0) NOT NULL,
      sequence numeric(20,0) NOT NULL
    )`);
    await queryRunner.query('DROP TABLE push_update_positions');
  }
}
