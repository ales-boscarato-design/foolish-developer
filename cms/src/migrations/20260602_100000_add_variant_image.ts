import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "products_variants" ADD COLUMN IF NOT EXISTS "image_id" integer REFERENCES "media"("id") ON DELETE SET NULL`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "products_variants_image_idx" ON "products_variants" ("image_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "products_variants_image_idx"`)
  await db.execute(sql`ALTER TABLE "products_variants" DROP COLUMN IF EXISTS "image_id"`)
}
