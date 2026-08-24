import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_payment_method AS ENUM ('bonifico', 'stripe', 'manual');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS payment_status enum_orders_payment_status DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS payment_method enum_orders_payment_method,
      ADD COLUMN IF NOT EXISTS stripe_payment_intent_id varchar
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_payment_intent_id_idx
      ON orders USING btree (stripe_payment_intent_id)
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS orders_stripe_payment_intent_id_idx
  `)
  await db.execute(sql`
    ALTER TABLE orders
      DROP COLUMN IF EXISTS payment_status,
      DROP COLUMN IF EXISTS payment_method,
      DROP COLUMN IF EXISTS stripe_payment_intent_id
  `)
  await db.execute(sql`
    DROP TYPE IF EXISTS enum_orders_payment_status
  `)
  await db.execute(sql`
    DROP TYPE IF EXISTS enum_orders_payment_method
  `)
}
