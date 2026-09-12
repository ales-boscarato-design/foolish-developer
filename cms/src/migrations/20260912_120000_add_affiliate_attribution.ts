import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_affiliates_status" AS ENUM ('active', 'paused', 'archived');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_affiliate_conversions_payment_status" AS ENUM ('paid', 'refunded', 'partially_refunded', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_affiliate_conversions_refund_status" AS ENUM ('none', 'partial', 'full');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "affiliates" (
      "id" serial PRIMARY KEY,
      "name" varchar NOT NULL,
      "slug" varchar NOT NULL,
      "status" "enum_affiliates_status" NOT NULL DEFAULT 'active',
      "contact_email" varchar,
      "promo_code_id" integer NOT NULL REFERENCES "promo_codes"("id"),
      "commission_base_rate_bps" numeric NOT NULL DEFAULT 1500,
      "commission_step_rate_bps" numeric NOT NULL DEFAULT 300,
      "commission_step_threshold_cents" numeric NOT NULL DEFAULT 50000,
      "commission_max_rate_bps" numeric NOT NULL DEFAULT 3800,
      "cookie_window_days" numeric NOT NULL DEFAULT 30,
      "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
      "created_at" timestamptz(3) NOT NULL DEFAULT now(),
      CONSTRAINT "affiliates_slug_shape_check" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
      CONSTRAINT "affiliates_base_rate_bps_check" CHECK ("commission_base_rate_bps" = trunc("commission_base_rate_bps") AND "commission_base_rate_bps" BETWEEN 0 AND 10000),
      CONSTRAINT "affiliates_step_rate_bps_check" CHECK ("commission_step_rate_bps" = trunc("commission_step_rate_bps") AND "commission_step_rate_bps" BETWEEN 0 AND 10000),
      CONSTRAINT "affiliates_step_threshold_cents_check" CHECK ("commission_step_threshold_cents" = trunc("commission_step_threshold_cents") AND "commission_step_threshold_cents" BETWEEN 1 AND 9007199254740991),
      CONSTRAINT "affiliates_max_rate_bps_check" CHECK ("commission_max_rate_bps" = trunc("commission_max_rate_bps") AND "commission_max_rate_bps" BETWEEN 0 AND 10000),
      CONSTRAINT "affiliates_cookie_window_days_check" CHECK ("cookie_window_days" = trunc("cookie_window_days") AND "cookie_window_days" BETWEEN 0 AND 3650)
    )
  `)

  await db.execute(sql`
    ALTER TABLE "affiliates" DROP CONSTRAINT IF EXISTS "affiliates_step_threshold_cents_check"
  `)
  await db.execute(sql`
    ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_step_threshold_cents_check"
      CHECK ("commission_step_threshold_cents" = trunc("commission_step_threshold_cents") AND "commission_step_threshold_cents" BETWEEN 1 AND 9007199254740991)
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_slug_idx" ON "affiliates" USING btree ("slug")`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "affiliates_promo_code_id_idx" ON "affiliates" USING btree ("promo_code_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliates_created_at_idx" ON "affiliates" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliates_updated_at_idx" ON "affiliates" USING btree ("updated_at")`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "affiliate_conversions" (
      "id" serial PRIMARY KEY,
      "stripe_session_id" varchar NOT NULL,
      "stripe_payment_intent_id" varchar,
      "order_number" varchar,
      "affiliate_id" integer NOT NULL REFERENCES "affiliates"("id"),
      "promo_code_snapshot" varchar NOT NULL,
      "affiliate_slug_snapshot" varchar NOT NULL,
      "eligible_amount_cents" numeric NOT NULL,
      "commission_rate_bps" numeric NOT NULL,
      "commission_amount_cents" numeric NOT NULL,
      "currency" varchar NOT NULL DEFAULT 'EUR',
      "payment_status" "enum_affiliate_conversions_payment_status" NOT NULL,
      "refund_status" "enum_affiliate_conversions_refund_status" NOT NULL DEFAULT 'none',
      "amount_refunded_cents" numeric NOT NULL DEFAULT 0,
      "paid_at" timestamptz(3),
      "refunded_at" timestamptz(3),
      "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
      "created_at" timestamptz(3) NOT NULL DEFAULT now(),
      CONSTRAINT "affiliate_conversions_promo_code_snapshot_shape_check" CHECK ("promo_code_snapshot" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'),
      CONSTRAINT "affiliate_conversions_slug_snapshot_shape_check" CHECK ("affiliate_slug_snapshot" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'),
      CONSTRAINT "affiliate_conversions_eligible_amount_cents_check" CHECK ("eligible_amount_cents" = trunc("eligible_amount_cents") AND "eligible_amount_cents" BETWEEN 0 AND 9007199254740991),
      CONSTRAINT "affiliate_conversions_rate_bps_check" CHECK ("commission_rate_bps" = trunc("commission_rate_bps") AND "commission_rate_bps" BETWEEN 0 AND 10000),
      CONSTRAINT "affiliate_conversions_commission_cents_check" CHECK ("commission_amount_cents" = trunc("commission_amount_cents") AND "commission_amount_cents" BETWEEN 0 AND 9007199254740991),
      CONSTRAINT "affiliate_conversions_currency_shape_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
      CONSTRAINT "affiliate_conversions_refunded_cents_check" CHECK ("amount_refunded_cents" = trunc("amount_refunded_cents") AND "amount_refunded_cents" BETWEEN 0 AND 9007199254740991)
    )
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "affiliate_conversions_stripe_session_id_idx" ON "affiliate_conversions" USING btree ("stripe_session_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_stripe_payment_intent_id_idx" ON "affiliate_conversions" USING btree ("stripe_payment_intent_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_order_number_idx" ON "affiliate_conversions" USING btree ("order_number")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_affiliate_id_idx" ON "affiliate_conversions" USING btree ("affiliate_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_payment_status_idx" ON "affiliate_conversions" USING btree ("payment_status")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_refund_status_idx" ON "affiliate_conversions" USING btree ("refund_status")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_created_at_idx" ON "affiliate_conversions" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "affiliate_conversions_updated_at_idx" ON "affiliate_conversions" USING btree ("updated_at")`)

  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "affiliate_promo_code" varchar,
      ADD COLUMN IF NOT EXISTS "affiliate_slug" varchar,
      ADD COLUMN IF NOT EXISTS "affiliate_eligible_amount_cents" numeric,
      ADD COLUMN IF NOT EXISTS "affiliate_commission_rate_bps" numeric,
      ADD COLUMN IF NOT EXISTS "affiliate_commission_cents" numeric
  `)
  await db.execute(sql`
      DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_promo_code_shape_check"
        CHECK ("affiliate_promo_code" IS NULL OR "affiliate_promo_code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_slug_shape_check"
        CHECK ("affiliate_slug" IS NULL OR "affiliate_slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_eligible_amount_cents_check"
        CHECK ("affiliate_eligible_amount_cents" IS NULL OR ("affiliate_eligible_amount_cents" = trunc("affiliate_eligible_amount_cents") AND "affiliate_eligible_amount_cents" BETWEEN 0 AND 9007199254740991));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_commission_rate_bps_check"
        CHECK ("affiliate_commission_rate_bps" IS NULL OR ("affiliate_commission_rate_bps" = trunc("affiliate_commission_rate_bps") AND "affiliate_commission_rate_bps" BETWEEN 0 AND 10000));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_affiliate_commission_cents_check"
        CHECK ("affiliate_commission_cents" IS NULL OR ("affiliate_commission_cents" = trunc("affiliate_commission_cents") AND "affiliate_commission_cents" BETWEEN 0 AND 9007199254740991));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "affiliates_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_affiliates_fk"
        FOREIGN KEY ("affiliates_id") REFERENCES "affiliates"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_affiliates_id_idx" ON "payload_locked_documents_rels" USING btree ("affiliates_id")`)

  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "affiliate_conversions_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_affiliate_conversions_fk"
        FOREIGN KEY ("affiliate_conversions_id") REFERENCES "affiliate_conversions"("id") ON DELETE cascade;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_affiliate_conversions_id_idx" ON "payload_locked_documents_rels" USING btree ("affiliate_conversions_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "affiliate_conversions_id"`)
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "affiliates_id"`)
  await db.execute(sql`DROP TABLE IF EXISTS "affiliate_conversions" CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS "affiliates" CASCADE`)
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "affiliate_promo_code"`)
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "affiliate_slug"`)
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "affiliate_eligible_amount_cents"`)
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "affiliate_commission_rate_bps"`)
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "affiliate_commission_cents"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_affiliate_conversions_refund_status"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_affiliate_conversions_payment_status"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_affiliates_status"`)
}
