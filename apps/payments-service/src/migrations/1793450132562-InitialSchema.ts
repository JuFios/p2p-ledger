import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1793450132562 implements MigrationInterface {
    name = 'InitialSchema1793450132562'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "transfers" ("id" uuid NOT NULL, "sender_user_id" uuid NOT NULL, "sender_email" character varying NOT NULL, "idempotency_key" character varying(128) NOT NULL, "request_hash" character varying(64) NOT NULL, "from_wallet_id" uuid NOT NULL, "recipient_email" character varying NOT NULL, "recipient_user_id" uuid, "to_wallet_id" uuid, "amount_minor" bigint NOT NULL, "currency" character(3) NOT NULL, "to_amount_minor" bigint, "to_currency" character(3) NOT NULL, "fx_rate" numeric(18,8), "fx_quoted_at" TIMESTAMP WITH TIME ZONE, "status" character varying(16) NOT NULL, "step" character varying(20) NOT NULL, "attempts" integer NOT NULL DEFAULT '0', "next_attempt_at" TIMESTAMP WITH TIME ZONE NOT NULL, "locked_until" TIMESTAMP WITH TIME ZONE, "failure_reason" character varying, "split_share_id" uuid, "traceparent" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_deb6f7d151c06729e15e5dfd55" CHECK ("step" IN ('RISK_CHECK', 'RESOLVE_RECIPIENT', 'FX_QUOTE', 'HOLD', 'CONFIRM', 'CAPTURE', 'RELEASE_HOLD', 'DONE')), CONSTRAINT "CHK_42e35891582ca10da003ed24eb" CHECK ("status" IN ('PENDING', 'PROCESSING', 'AWAITING_RETRY', 'COMPENSATING', 'COMPLETED', 'FAILED')), CONSTRAINT "CHK_63d771c91208029aafcdaa8f5c" CHECK ("amount_minor" > 0), CONSTRAINT "PK_f712e908b465e0085b4408cabc3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_c516658b1f7c6fce12a9209e9b" ON "transfers" ("split_share_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_3c4d3e11851a5676ca06db3f7e" ON "transfers" ("recipient_user_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_a3d1cc8faa4534e5bdfaadbb06" ON "transfers" ("sender_user_id", "created_at") `);
        await queryRunner.query(`CREATE INDEX "IDX_df6a3304429b8ba0f766a7e12b" ON "transfers" ("status", "next_attempt_at") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_865e11fb9cc4e0ea46be449ecd" ON "transfers" ("sender_user_id", "idempotency_key") `);
        await queryRunner.query(`CREATE TABLE "outbox" ("id" BIGSERIAL NOT NULL, "event_id" uuid NOT NULL, "type" character varying NOT NULL, "version" smallint NOT NULL, "payload" jsonb NOT NULL, "user_ids" uuid array NOT NULL, "traceparent" character varying, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "UQ_cc0c9e40998e45ecfc5e313429d" UNIQUE ("event_id"), CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_outbox_unpublished" ON "outbox" ("id") WHERE "published_at" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX "public"."IDX_outbox_unpublished"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_865e11fb9cc4e0ea46be449ecd"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_df6a3304429b8ba0f766a7e12b"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_a3d1cc8faa4534e5bdfaadbb06"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3c4d3e11851a5676ca06db3f7e"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_c516658b1f7c6fce12a9209e9b"`);
        await queryRunner.query(`DROP TABLE "transfers"`);
    }

}
