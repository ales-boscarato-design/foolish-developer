import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products" RENAME COLUMN "reseller_description" TO "reseller_description_it"`)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reseller_description_en" varchar`)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reseller_description_de" varchar`)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reseller_description_fr" varchar`)
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reseller_description_es" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_description_en"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_description_de"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_description_fr"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_description_es"`)
  await db.execute(sql`ALTER TABLE "products" RENAME COLUMN "reseller_description_it" TO "reseller_description"`)
}
