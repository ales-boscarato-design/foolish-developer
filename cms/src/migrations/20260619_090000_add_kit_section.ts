import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TYPE "public"."enum_products_section" ADD VALUE IF NOT EXISTS 'kit'
  `)
}

export async function down(_: MigrateDownArgs): Promise<void> {
  // Postgres does not support removing enum values without recreating the type.
  // Leave as-is on rollback.
}
