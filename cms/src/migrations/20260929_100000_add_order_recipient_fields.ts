import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_address_first_name" varchar,
      ADD COLUMN IF NOT EXISTS "shipping_address_last_name" varchar,
      ADD COLUMN IF NOT EXISTS "shipping_address_province" varchar
  `)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Rollback is a code revert; intentionally preserve recipient data in these columns.
}
