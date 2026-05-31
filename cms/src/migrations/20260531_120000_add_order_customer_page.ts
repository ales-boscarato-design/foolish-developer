import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // ── Nuovi campi scalari sulla tabella orders ───────────────
  await db.execute(sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS customer_locale  varchar,
      ADD COLUMN IF NOT EXISTS page_token       varchar
  `)

  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS orders_page_token_idx ON orders USING btree (page_token)
  `)

  // ── Enum per content_blocks.type ──────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_orders_content_blocks_type AS ENUM ('guide', 'announcement', 'offer', 'tip');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // ── Tabella array: orders_sheet_photos ────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS orders_sheet_photos (
      id        serial PRIMARY KEY,
      "order"   integer NOT NULL,
      parent_id integer NOT NULL,
      url       varchar NOT NULL,
      caption   varchar,
      CONSTRAINT orders_sheet_photos_parent_fk
        FOREIGN KEY (parent_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_sheet_photos_order_idx     ON orders_sheet_photos USING btree ("order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_sheet_photos_parent_idx    ON orders_sheet_photos USING btree (parent_id)`)

  // ── Tabella array: orders_content_blocks ──────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS orders_content_blocks (
      id         serial PRIMARY KEY,
      "order"    integer NOT NULL,
      parent_id  integer NOT NULL,
      type       enum_orders_content_blocks_type NOT NULL,
      title      varchar NOT NULL,
      body       varchar NOT NULL,
      cta_label  varchar,
      cta_url    varchar,
      active     boolean NOT NULL DEFAULT true,
      expires_at timestamptz(3),
      CONSTRAINT orders_content_blocks_parent_fk
        FOREIGN KEY (parent_id) REFERENCES orders(id) ON DELETE CASCADE
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_content_blocks_order_idx   ON orders_content_blocks USING btree ("order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS orders_content_blocks_parent_idx  ON orders_content_blocks USING btree (parent_id)`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS orders_content_blocks CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS orders_sheet_photos CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_orders_content_blocks_type`)
  await db.execute(sql`DROP INDEX IF EXISTS orders_page_token_idx`)
  await db.execute(sql`ALTER TABLE orders DROP COLUMN IF EXISTS page_token`)
  await db.execute(sql`ALTER TABLE orders DROP COLUMN IF EXISTS customer_locale`)
}
