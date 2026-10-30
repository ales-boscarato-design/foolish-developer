import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Backfill additivo dei proprietari e dei media privati gia' associati a customer-files.
 * Il down rimuove solo colonna e indice; non ripubblica i media, intenzionalmente.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "customer_files" ADD COLUMN IF NOT EXISTS "customer_email" varchar`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "customer_files_customer_email_idx" ON "customer_files" USING btree ("customer_email")`)
  await db.execute(sql`
    UPDATE "customer_files" cf
    SET "customer_email" = lower(c."email")
    FROM "customers" c
    WHERE cf."customer_id" = c."id"
      AND (cf."customer_email" IS NULL OR cf."customer_email" = '')
  `)
  await db.execute(sql`
    UPDATE "media" SET "visibility" = 'private'
    WHERE "id" IN (SELECT "file_id" FROM "customer_files" WHERE "customer_id" IS NOT NULL)
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Non rimuovere mai visibility e non riportare documenti privati a public.
  await db.execute(sql`DROP INDEX IF EXISTS "customer_files_customer_email_idx"`)
  await db.execute(sql`ALTER TABLE "customer_files" DROP COLUMN IF EXISTS "customer_email"`)
}
