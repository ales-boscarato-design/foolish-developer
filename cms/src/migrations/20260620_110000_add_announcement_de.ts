import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "title_de" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "body_de" varchar`)
  await db.execute(sql`ALTER TABLE "announcements" ADD COLUMN IF NOT EXISTS "content_de" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "title_de"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "body_de"`)
  await db.execute(sql`ALTER TABLE "announcements" DROP COLUMN IF EXISTS "content_de"`)
}
