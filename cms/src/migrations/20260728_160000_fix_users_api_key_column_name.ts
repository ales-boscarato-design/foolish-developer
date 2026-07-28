import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// La migrazione precedente (20260728_140000) ha creato la colonna come "enable_api_key"
// ma Payload ORM la genera come "enable_a_p_i_key" (snake_case lettera per lettera da enableAPIKey).
// Rinomina per allinearsi al nome atteso dall'ORM.
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
    RENAME COLUMN "enable_api_key" TO "enable_a_p_i_key"
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
    RENAME COLUMN "enable_a_p_i_key" TO "enable_api_key"
  `)
}
