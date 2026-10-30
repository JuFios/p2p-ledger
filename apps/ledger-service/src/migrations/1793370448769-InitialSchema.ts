import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1793370448769 implements MigrationInterface {
    name = 'InitialSchema1793370448769'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() для users.id (як у стартовій схемі)
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`
            CREATE TABLE "users" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "email" character varying NOT NULL,
                "passwordHash" character varying NOT NULL,
                "refreshTokenHash" character varying,
                "role" character varying NOT NULL DEFAULT 'user',
                CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"),
                CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "wallet_balances" (
                "wallet_id" uuid NOT NULL,
                "available" bigint NOT NULL DEFAULT '0',
                "held" bigint NOT NULL DEFAULT '0',
                "last_position" bigint NOT NULL DEFAULT '0',
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_418cafcad0e431243e9303d3a3" CHECK ("held" >= 0),
                CONSTRAINT "CHK_4dfcad9dc84cc51d22adde6111" CHECK ("available" >= 0),
                CONSTRAINT "PK_df71d0f9058318ebc25302aa365" PRIMARY KEY ("wallet_id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "wallets" (
                "id" uuid NOT NULL,
                "owner_id" uuid NOT NULL,
                "currency" character(3) NOT NULL,
                "frozen" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_08e1b37752b0c4bd0dd2e5370b2" UNIQUE ("owner_id", "currency"),
                CONSTRAINT "PK_8402e5df5a30a229380e83e4f7e" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "events" (
                "global_position" BIGSERIAL NOT NULL,
                "event_id" uuid NOT NULL,
                "stream_id" character varying NOT NULL,
                "stream_version" integer NOT NULL,
                "event_type" character varying NOT NULL,
                "schema_version" smallint NOT NULL,
                "payload" jsonb NOT NULL,
                "metadata" jsonb NOT NULL,
                "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_1b77463a4487f09e798dffcb43a" UNIQUE ("event_id"),
                CONSTRAINT "UQ_events_stream_version" UNIQUE ("stream_id", "stream_version"),
                CONSTRAINT "PK_fccb4026be9f4c1402415a5c686" PRIMARY KEY ("global_position")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_0ac7ba216ceb71329b25a1829c" ON "events" ("recorded_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "postings" (
                "id" BIGSERIAL NOT NULL,
                "event_id" uuid NOT NULL,
                "operation_id" character varying NOT NULL,
                "account" character varying NOT NULL,
                "currency" character(3) NOT NULL,
                "direction" character varying(6) NOT NULL,
                "amount_minor" bigint NOT NULL,
                "recorded_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_96fbe062db1feae73d46b7849d" CHECK ("amount_minor" > 0),
                CONSTRAINT "CHK_8cbd8d85b919816e9554382b11" CHECK ("direction" IN ('DEBIT', 'CREDIT')),
                CONSTRAINT "PK_6bdb1a5dc47d018aa7877aa9ffb" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_12baef2b0d5cd9987db6035d49" ON "postings" ("operation_id")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_949dd043782527809bad65c48c" ON "postings" ("account")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_6df044397c958705befe0b4dab" ON "postings" ("recorded_at")
        `);
        await queryRunner.query(`
            CREATE TABLE "operations" (
                "operation_id" character varying NOT NULL,
                "type" character varying NOT NULL,
                "request_hash" character varying NOT NULL,
                "result" jsonb NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_3ccb98a1664e5858a2be2822301" PRIMARY KEY ("operation_id")
            )
        `);
        await queryRunner.query(`
            CREATE TABLE "holds" (
                "hold_id" uuid NOT NULL,
                "wallet_id" uuid NOT NULL,
                "amount_minor" bigint NOT NULL,
                "currency" character(3) NOT NULL,
                "status" character varying(8) NOT NULL,
                "transfer_id" uuid NOT NULL,
                CONSTRAINT "CHK_7df63e8f84838a58d62d4af67a" CHECK ("amount_minor" > 0),
                CONSTRAINT "CHK_55f6907570afe657c5d098b2bc" CHECK ("status" IN ('ACTIVE', 'RELEASED', 'CAPTURED')),
                CONSTRAINT "PK_8d5b49d0477aae225e4c7e64b04" PRIMARY KEY ("hold_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_8c62d1bb2540597e00c844b30c" ON "holds" ("wallet_id", "status")
        `);
        await queryRunner.query(`
            CREATE TABLE "outbox" (
                "id" BIGSERIAL NOT NULL,
                "event_id" uuid NOT NULL,
                "type" character varying NOT NULL,
                "version" smallint NOT NULL,
                "payload" jsonb NOT NULL,
                "user_ids" uuid array NOT NULL,
                "traceparent" character varying,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "published_at" TIMESTAMP WITH TIME ZONE,
                CONSTRAINT "UQ_cc0c9e40998e45ecfc5e313429d" UNIQUE ("event_id"),
                CONSTRAINT "PK_340ab539f309f03bdaa14aa7649" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_outbox_unpublished" ON "outbox" ("id")
            WHERE "published_at" IS NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "wallet_balances"
            ADD CONSTRAINT "FK_df71d0f9058318ebc25302aa365" FOREIGN KEY ("wallet_id") REFERENCES "wallets"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
        `);
        // Event store і журнал проводок — append-only: змінити чи видалити
        // записане не можна навіть прямим SQL.
        await queryRunner.query(`
            CREATE FUNCTION forbid_append_only_mutation() RETURNS trigger
            LANGUAGE plpgsql AS $$
            BEGIN
                RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
            END
            $$
        `);
        for (const table of ['events', 'postings']) {
            await queryRunner.query(`
                CREATE TRIGGER "${table}_append_only"
                BEFORE UPDATE OR DELETE ON "${table}"
                FOR EACH ROW EXECUTE FUNCTION forbid_append_only_mutation()
            `);
            await queryRunner.query(`
                CREATE TRIGGER "${table}_no_truncate"
                BEFORE TRUNCATE ON "${table}"
                FOR EACH STATEMENT EXECUTE FUNCTION forbid_append_only_mutation()
            `);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP FUNCTION forbid_append_only_mutation() CASCADE
        `);
        await queryRunner.query(`
            ALTER TABLE "wallet_balances" DROP CONSTRAINT "FK_df71d0f9058318ebc25302aa365"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_outbox_unpublished"
        `);
        await queryRunner.query(`
            DROP TABLE "outbox"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_8c62d1bb2540597e00c844b30c"
        `);
        await queryRunner.query(`
            DROP TABLE "holds"
        `);
        await queryRunner.query(`
            DROP TABLE "operations"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_6df044397c958705befe0b4dab"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_949dd043782527809bad65c48c"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_12baef2b0d5cd9987db6035d49"
        `);
        await queryRunner.query(`
            DROP TABLE "postings"
        `);
        await queryRunner.query(`
            DROP INDEX "public"."IDX_0ac7ba216ceb71329b25a1829c"
        `);
        await queryRunner.query(`
            DROP TABLE "events"
        `);
        await queryRunner.query(`
            DROP TABLE "wallets"
        `);
        await queryRunner.query(`
            DROP TABLE "wallet_balances"
        `);
        await queryRunner.query(`
            DROP TABLE "users"
        `);
    }

}
