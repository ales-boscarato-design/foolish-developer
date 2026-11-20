import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Snapshot cumulativo dei rimborsi Stripe sugli ordini.
 * I campi restano NULL sugli ordini storici: nessun backfill presume zero.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_refund_status AS ENUM ('none', 'partial', 'full');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "amount_refunded_cents" numeric,
      ADD COLUMN IF NOT EXISTS "refund_status" enum_orders_refund_status,
      ADD COLUMN IF NOT EXISTS "last_refunded_at" timestamptz
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "last_refunded_at",
      DROP COLUMN IF EXISTS "refund_status",
      DROP COLUMN IF EXISTS "amount_refunded_cents"
  `)
  await db.execute(sql`DROP TYPE IF EXISTS enum_orders_refund_status`)
}
