import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "products"
      ADD COLUMN IF NOT EXISTS "unlisted" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "superseded_by" varchar(63)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_unlisted_idx" ON "products" USING btree ("unlisted")
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "products_unlisted_idx"`)
  await db.execute(sql`
    ALTER TABLE "products"
      DROP COLUMN IF EXISTS "superseded_by",
      DROP COLUMN IF EXISTS "unlisted"
  `)
}
