import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "offer_config" (
      "id"              serial PRIMARY KEY,
      "title"           varchar NOT NULL DEFAULT 'Offerta post-ordine',
      "active"          boolean NOT NULL DEFAULT true,
      "product_id"      integer REFERENCES products(id),
      "threshold"       numeric NOT NULL DEFAULT 50,
      "discount_below"  integer NOT NULL DEFAULT 10,
      "discount_above"  integer NOT NULL DEFAULT 15,
      "validity_hours"  integer NOT NULL DEFAULT 24,
      "updated_at"      timestamptz(3) NOT NULL DEFAULT now(),
      "created_at"      timestamptz(3) NOT NULL DEFAULT now()
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "offer_config_created_at_idx" ON "offer_config" USING btree ("created_at")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "offer_config"`)
}
