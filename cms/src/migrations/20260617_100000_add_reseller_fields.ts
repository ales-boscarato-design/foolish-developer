import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Add resellerVisible checkbox to products
  await db.execute(sql`
    ALTER TABLE "products"
    ADD COLUMN IF NOT EXISTS "reseller_visible" boolean DEFAULT false
  `)

  // Create price_tiers array table for products
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_price_tiers" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "min_qty" numeric NOT NULL,
      "max_qty" numeric,
      "discount_percent" numeric NOT NULL
    )
  `)

  await db.execute(sql`
    ALTER TABLE "products_price_tiers"
      ADD CONSTRAINT "products_price_tiers_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "products"("id")
      ON DELETE cascade ON UPDATE no action
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_price_tiers_order_idx"
    ON "products_price_tiers" USING btree ("_order")
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_price_tiers_parent_id_idx"
    ON "products_price_tiers" USING btree ("_parent_id")
  `)

  // Note: the orders.source field is stored as text in Payload v3 — no schema change needed
  // for adding a new select option value ('reseller').
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "products_price_tiers"`)
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_visible"`)
}
