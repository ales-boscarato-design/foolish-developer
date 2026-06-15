import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Orders: add customerPhone field (added to collection on 2026-06-14, no migration created)
  await db.execute(sql`ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "customer_phone" varchar`)

  // PromoCodes: add new enum values for percent and amount discount types
  await db.execute(sql`ALTER TYPE "enum_promo_codes_type" ADD VALUE IF NOT EXISTS 'percent'`)
  await db.execute(sql`ALTER TYPE "enum_promo_codes_type" ADD VALUE IF NOT EXISTS 'amount'`)

  // PromoCodes: add discountPercent, discountAmount, expiresAt fields
  await db.execute(sql`ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "discount_percent" numeric`)
  await db.execute(sql`ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "discount_amount" numeric`)
  await db.execute(sql`ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "expires_at" timestamptz(3)`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "orders" DROP COLUMN IF EXISTS "customer_phone"`)
  await db.execute(sql`ALTER TABLE "promo_codes" DROP COLUMN IF EXISTS "discount_percent"`)
  await db.execute(sql`ALTER TABLE "promo_codes" DROP COLUMN IF EXISTS "discount_amount"`)
  await db.execute(sql`ALTER TABLE "promo_codes" DROP COLUMN IF EXISTS "expires_at"`)
  // Note: PostgreSQL does not support removing enum values, so enum stays as-is on down
}
