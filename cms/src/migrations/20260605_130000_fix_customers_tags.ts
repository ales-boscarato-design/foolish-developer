import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// customers_tags was missing the `value` column required by Payload for select hasMany fields.
// The order/parent_id columns are correct without underscore prefix (Payload convention for simple arrays).

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "customers_tags" ADD COLUMN IF NOT EXISTS "value" varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "customers_tags" DROP COLUMN IF EXISTS "value"`)
}
