import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // Enum types (PostgreSQL doesn't support IF NOT EXISTS for CREATE TYPE)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_source AS ENUM ('storefront', 'woocommerce', 'manual');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_pipeline_state AS ENUM ('received', 'eta_pending', 'eta_confirmed', 'in_production', 'matching_pending', 'matched', 'preview_sent', 'shipped', 'delivered', 'followup_done', 'closed');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_customers_preferred_channel AS ENUM ('telegram', 'email');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_customers_tags AS ENUM ('tatuatore', 'pmu', 'studente', 'professionista', 'vip');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // Customers table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      email varchar NOT NULL,
      name varchar,
      telegram_id varchar,
      telegram_username varchar,
      preferred_channel enum_customers_preferred_channel DEFAULT 'email',
      country varchar,
      total_orders numeric DEFAULT 0,
      notes varchar,
      updated_at timestamptz(3) NOT NULL DEFAULT now(),
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  // Customers indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS customers_created_at_idx ON customers USING btree (created_at)`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS customers_email_idx ON customers USING btree (email)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS customers_updated_at_idx ON customers USING btree (updated_at)`)

  // Customers tags (relation table)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers_tags (
      id serial PRIMARY KEY,
      "order" integer NOT NULL,
      parent_id integer NOT NULL,
      value enum_customers_tags,
      CONSTRAINT customers_tags_parent_fk FOREIGN KEY (parent_id) REFERENCES customers(id) ON DELETE CASCADE
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS customers_tags_order_idx ON customers_tags USING btree ("order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS customers_tags_parent_idx ON customers_tags USING btree (parent_id)`)

  // Orders table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS orders (
      id serial PRIMARY KEY,
      order_number varchar NOT NULL,
      source enum_orders_source DEFAULT 'storefront',
      customer_email varchar NOT NULL,
      customer_name varchar,
      customer_telegram_id varchar,
      line_items jsonb NOT NULL,
      total numeric NOT NULL,
      shipping_cost numeric,
      shipping_address_name varchar,
      shipping_address_address1 varchar,
      shipping_address_address2 varchar,
      shipping_address_city varchar,
      shipping_address_postal_code varchar,
      shipping_address_country varchar,
      pipeline_state enum_orders_pipeline_state DEFAULT 'received',
      revolut_order_id varchar,
      revolut_status varchar,
      tracking_number varchar,
      tracking_carrier varchar,
      production_eta_days numeric,
      notes varchar,
      updated_at timestamptz(3) NOT NULL DEFAULT now(),
      created_at timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  // Orders indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders USING btree (created_at)`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS orders_order_number_idx ON orders USING btree (order_number)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_updated_at_idx ON orders USING btree (updated_at)`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS orders CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS customers_tags CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS customers CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_orders_source`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_orders_pipeline_state`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_customers_preferred_channel`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_customers_tags`)
}
