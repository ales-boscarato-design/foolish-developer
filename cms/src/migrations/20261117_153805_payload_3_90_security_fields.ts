import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/*
 * Migration idempotente per i campi di sicurezza Payload 3.90.
 *
 * Il generatore `payload migrate:create` ha rigenerato anche otto indici sulle
 * tabelle *_locales che pero' sono gia' presenti in produzione, create dalle
 * migration precedenti. Un `CREATE INDEX` senza guardia farebbe fallire
 * `payload migrate` all'avvio del servizio: il Dockerfile del CMS esegue
 * `payload migrate` prima di `next start`, quindi un errore qui blocca l'avvio
 * del CMS e di conseguenza il deploy. Per questo ogni operazione usa
 * `IF NOT EXISTS` (up) e `IF EXISTS` (down), cosi' la migration e' sicura sia
 * su un database gia' allineato sia su uno nuovo.
 */
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "reset_password_requested_at" timestamp(3) with time zone;
  CREATE INDEX IF NOT EXISTS "products_variants_locales_parent_id_idx" ON "products_variants_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_attributes_options_locales_parent_id_idx" ON "products_attributes_options_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_attributes_locales_parent_id_idx" ON "products_attributes_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_feature_highlights_locales_parent_id_idx" ON "products_feature_highlights_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_usage_steps_locales_parent_id_idx" ON "products_usage_steps_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_packs_locales_parent_id_idx" ON "products_packs_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_whats_in_the_box_locales_parent_id_idx" ON "products_whats_in_the_box_locales" USING btree ("_parent_id");
  CREATE INDEX IF NOT EXISTS "products_locales_parent_id_idx" ON "products_locales" USING btree ("_parent_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX IF EXISTS "products_variants_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_attributes_options_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_attributes_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_feature_highlights_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_usage_steps_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_packs_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_whats_in_the_box_locales_parent_id_idx";
  DROP INDEX IF EXISTS "products_locales_parent_id_idx";
  ALTER TABLE "users" DROP COLUMN IF EXISTS "reset_password_requested_at";`)
}
