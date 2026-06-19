import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "title_en" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "body_en" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "content_en" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "title_fr" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "body_fr" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "content_fr" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "title_es" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "body_es" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "content_es" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "title_en"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "body_en"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "content_en"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "title_fr"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "body_fr"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "content_fr"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "title_es"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "body_es"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "content_es"`)
}
