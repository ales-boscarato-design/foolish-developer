import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Join table for products.components (hasMany relationship to products)
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_rels (
      id serial PRIMARY KEY,
      "order" integer,
      parent_id integer NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      path varchar NOT NULL,
      products_id integer REFERENCES products(id) ON DELETE CASCADE
    )
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS products_rels_order_idx ON products_rels ("order")
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS products_rels_parent_idx ON products_rels (parent_id)
  `)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS products_rels_products_idx ON products_rels (products_id)
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS products_rels`)
}
