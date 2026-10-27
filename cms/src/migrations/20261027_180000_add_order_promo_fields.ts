import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Snapshot promo sugli ordini: `promo_code`, `promo_type`, `promo_discount_cents`.
 *
 * Tutte e tre le colonne sono nullable e senza default: un ordine senza promo resta
 * valido con NULL esplicito, e i vincoli usano `IS NULL OR ...` per accettarlo.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_orders_promo_type" AS ENUM ('free_shipping', 'percent_pro', 'percent', 'amount', 'percent_tiered');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "promo_code" varchar,
      ADD COLUMN IF NOT EXISTS "promo_type" "enum_orders_promo_type",
      ADD COLUMN IF NOT EXISTS "promo_discount_cents" numeric
  `)

  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_code_shape_check"
        CHECK ("promo_code" IS NULL OR "promo_code" ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "orders" ADD CONSTRAINT "orders_promo_discount_cents_check"
        CHECK ("promo_discount_cents" IS NULL OR ("promo_discount_cents" = trunc("promo_discount_cents") AND "promo_discount_cents" BETWEEN 0 AND 9007199254740991));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "orders_promo_code_idx" ON "orders" USING btree ("promo_code");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "orders_promo_code_idx"`)
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP CONSTRAINT IF EXISTS "orders_promo_discount_cents_check",
      DROP CONSTRAINT IF EXISTS "orders_promo_code_shape_check"
  `)
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "promo_discount_cents",
      DROP COLUMN IF EXISTS "promo_type",
      DROP COLUMN IF EXISTS "promo_code"
  `)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_orders_promo_type"`)
}
