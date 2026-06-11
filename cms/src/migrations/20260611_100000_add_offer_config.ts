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

  // Register in payload_locked_documents_rels
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "offer_config_id" integer`)
  try {
    await db.execute(sql`
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_offer_config_fk"
        FOREIGN KEY ("offer_config_id") REFERENCES "offer_config"("id") ON DELETE CASCADE
    `)
  } catch { /* constraint may already exist */ }
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_offer_config_id_idx" ON "payload_locked_documents_rels" USING btree ("offer_config_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "offer_config_id"`)
  await db.execute(sql`DROP TABLE IF EXISTS "offer_config"`)
}
