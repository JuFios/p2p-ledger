import { MigrationInterface, QueryRunner } from 'typeorm';

export class WalletUpdatePositions1793538000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE wallet_update_positions (
      wallet_id uuid PRIMARY KEY,
      milliseconds numeric(20,0) NOT NULL,
      sequence numeric(20,0) NOT NULL
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE wallet_update_positions');
  }
}
