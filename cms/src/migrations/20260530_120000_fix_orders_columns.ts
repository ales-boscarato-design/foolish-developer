import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Enum types (idempotent via DO block)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_source AS ENUM ('storefront', 'woocommerce', 'manual');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_pipeline_state AS ENUM (
        'received', 'eta_pending', 'eta_confirmed', 'in_production',
        'matching_pending', 'matched', 'preview_sent', 'shipped',
        'delivered', 'followup_done', 'closed'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // Add missing columns to orders table (IF NOT EXISTS — safe to re-run)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS source enum_orders_source DEFAULT 'storefront'`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_telegram_id varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_cost numeric`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_name varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_address1 varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_address2 varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_city varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_postal_code varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipping_address_country varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS pipeline_state enum_orders_pipeline_state DEFAULT 'received'`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS revolut_order_id varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS revolut_status varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_number varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS tracking_carrier varchar`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS production_eta_days numeric`)
  await db.execute(sql`ALTER TABLE orders ADD COLUMN IF NOT EXISTS notes varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // No-op — don't drop columns on rollback
}
