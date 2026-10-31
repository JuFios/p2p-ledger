import { MigrationInterface, QueryRunner } from "typeorm";

export class SplitBillIdempotency1793456057896 implements MigrationInterface {
    name = 'SplitBillIdempotency1793456057896'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "split_bills" ADD "idempotency_key" character varying(128)`);
        await queryRunner.query(`ALTER TABLE "split_bills" ADD "request_hash" character varying(64)`);
        await queryRunner.query(`CREATE INDEX "IDX_cf879f8788a0743fdbd00c0925" ON "split_bills" ("due_at") WHERE "due_at" IS NOT NULL`);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_0cf7c123735fb702b05b65b226" ON "split_bills" ("creator_user_id", "idempotency_key") `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_0cf7c123735fb702b05b65b226"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_cf879f8788a0743fdbd00c0925"`);
        await queryRunner.query(`ALTER TABLE "split_bills" DROP COLUMN "request_hash"`);
        await queryRunner.query(`ALTER TABLE "split_bills" DROP COLUMN "idempotency_key"`);
    }

}
