import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRefreshSession1793658000000 implements MigrationInterface {
  name = 'AddRefreshSession1793658000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "users" ADD "refreshSessionId" character varying',
    );
    // Чинні токени без sid зберігають можливість refresh і logout.
    await queryRunner.query(`
      UPDATE "users" SET "refreshSessionId" = "refreshTokenHash"
      WHERE "refreshTokenHash" ~ '^[a-f0-9]{64}$'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE "users" DROP COLUMN "refreshSessionId"');
  }
}
