import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products_locales" ADD COLUMN IF NOT EXISTS "meta_title" varchar`)
  await db.execute(sql`ALTER TABLE "products_locales" ADD COLUMN IF NOT EXISTS "meta_description" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products_locales" DROP COLUMN IF EXISTS "meta_description"`)
  await db.execute(sql`ALTER TABLE "products_locales" DROP COLUMN IF EXISTS "meta_title"`)
}
