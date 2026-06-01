import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_packs" (
      "_order"           integer NOT NULL,
      "_parent_id"       integer NOT NULL,
      "id"               varchar PRIMARY KEY NOT NULL,
      "name"             varchar NOT NULL,
      "quantity"         numeric NOT NULL,
      "discount_percent" numeric NOT NULL,
      "badge_text"       varchar
    )
  `)
  await db.execute(sql`
    ALTER TABLE "products_packs"
      ADD CONSTRAINT "products_packs_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "products"("id")
      ON DELETE cascade ON UPDATE no action
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "products_packs_order_idx" ON "products_packs" USING btree ("_order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "products_packs_parent_id_idx" ON "products_packs" USING btree ("_parent_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "products_packs" CASCADE`)
}
