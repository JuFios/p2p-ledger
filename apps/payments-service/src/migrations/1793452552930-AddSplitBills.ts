import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSplitBills1793452552930 implements MigrationInterface {
    name = 'AddSplitBills1793452552930'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "split_shares" ("id" uuid NOT NULL, "bill_id" uuid NOT NULL, "position" smallint NOT NULL, "participant_user_id" uuid NOT NULL, "participant_email" character varying NOT NULL, "amount_minor" bigint NOT NULL, "status" character varying(8) NOT NULL DEFAULT 'PENDING', "last_reminded_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_ece3d6ca7854411bc6a82dcf4f" CHECK ("status" IN ('PENDING', 'ACCEPTED', 'PAYING', 'PAID')), CONSTRAINT "CHK_afd9cacb9fbce56b9cdee1026e" CHECK ("amount_minor" > 0), CONSTRAINT "PK_542165497eaccf45772239fd974" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_1d13a5a134392a0d2f26cbe8c6" ON "split_shares" ("participant_user_id") `);
        await queryRunner.query(`CREATE UNIQUE INDEX "IDX_9007eadb417f9f77e31a34f687" ON "split_shares" ("bill_id", "participant_user_id") `);
        await queryRunner.query(`CREATE TABLE "split_bills" ("id" uuid NOT NULL, "creator_user_id" uuid NOT NULL, "creator_email" character varying NOT NULL, "title" character varying(100) NOT NULL, "total_minor" bigint NOT NULL, "currency" character(3) NOT NULL, "mode" character varying(6) NOT NULL, "due_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "CHK_f47fd3e0d2badecbb1a3a57933" CHECK ("mode" IN ('EQUAL', 'CUSTOM')), CONSTRAINT "CHK_c767210b20667edbb4e041275a" CHECK ("total_minor" > 0), CONSTRAINT "PK_5ab7131b31fbbc911517643e164" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_5c672404e58e7b3cec28032335" ON "split_bills" ("creator_user_id", "created_at") `);
        await queryRunner.query(`ALTER TABLE "split_shares" ADD CONSTRAINT "FK_65e75d6b5080334889caa1fd2c4" FOREIGN KEY ("bill_id") REFERENCES "split_bills"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "split_shares" DROP CONSTRAINT "FK_65e75d6b5080334889caa1fd2c4"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_5c672404e58e7b3cec28032335"`);
        await queryRunner.query(`DROP TABLE "split_bills"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_9007eadb417f9f77e31a34f687"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_1d13a5a134392a0d2f26cbe8c6"`);
        await queryRunner.query(`DROP TABLE "split_shares"`);
    }

}
