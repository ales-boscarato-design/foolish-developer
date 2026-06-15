import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Normalize all promo codes to uppercase to match the validate route normalization
  await db.execute(sql`UPDATE "promo_codes" SET "code" = UPPER("code") WHERE "code" != UPPER("code")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // No rollback: we can't know original casing
}
