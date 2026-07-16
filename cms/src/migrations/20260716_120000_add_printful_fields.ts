import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_products_section" ADD VALUE IF NOT EXISTS 'merch'
  `)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "printful_sync_product_id" varchar`)
  await db.execute(sql`ALTER TABLE "products_variants" ADD COLUMN IF NOT EXISTS "printful_sync_variant_id" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products_variants" DROP COLUMN IF EXISTS "printful_sync_variant_id"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "printful_sync_product_id"`)
  // Postgres does not support removing enum values without recreating the type.
  // Leave 'merch' in enum_products_section on rollback.
}
