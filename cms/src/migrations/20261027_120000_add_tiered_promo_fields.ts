import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TYPE "enum_promo_codes_type" ADD VALUE IF NOT EXISTS 'percent_tiered'`)
  await db.execute(sql`
    ALTER TABLE "promo_codes"
      ADD COLUMN IF NOT EXISTS "min_subtotal_cents" numeric,
      ADD COLUMN IF NOT EXISTS "tier2_subtotal_cents" numeric,
      ADD COLUMN IF NOT EXISTS "tier2_discount_percent" numeric
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "promo_codes"
      DROP COLUMN IF EXISTS "tier2_discount_percent",
      DROP COLUMN IF EXISTS "tier2_subtotal_cents",
      DROP COLUMN IF EXISTS "min_subtotal_cents"
  `)
}
