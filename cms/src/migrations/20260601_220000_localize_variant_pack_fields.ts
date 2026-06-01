import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Localizza i campi:
 *   products_variants.description  → products_variants_locales
 *   products_packs.name            → products_packs_locales
 *   products_packs.badge_text      → products_packs_locales
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {

  // ── products_variants_locales ─────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_variants_locales" (
      "description" varchar,
      "id"          serial PRIMARY KEY NOT NULL,
      "_locale"     "_locales" NOT NULL,
      "_parent_id"  varchar NOT NULL
    )
  `)
  await db.execute(sql`
    ALTER TABLE "products_variants_locales"
      ADD CONSTRAINT "products_variants_locales_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "products_variants"("id")
      ON DELETE cascade ON UPDATE no action
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "products_variants_locales_locale_parent_id_unique"
      ON "products_variants_locales" USING btree ("_locale", "_parent_id")
  `)

  // Migra dati esistenti → locale IT
  await db.execute(sql`
    INSERT INTO "products_variants_locales" (description, _locale, _parent_id)
    SELECT description, 'it', id
    FROM "products_variants"
    WHERE description IS NOT NULL
    ON CONFLICT DO NOTHING
  `)
  await db.execute(sql`ALTER TABLE "products_variants" DROP COLUMN IF EXISTS "description"`)

  // ── products_packs_locales ────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_packs_locales" (
      "name"       varchar NOT NULL,
      "badge_text" varchar,
      "id"         serial PRIMARY KEY NOT NULL,
      "_locale"    "_locales" NOT NULL,
      "_parent_id" varchar NOT NULL
    )
  `)
  await db.execute(sql`
    ALTER TABLE "products_packs_locales"
      ADD CONSTRAINT "products_packs_locales_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "products_packs"("id")
      ON DELETE cascade ON UPDATE no action
  `)
  await db.execute(sql`
    CREATE UNIQUE INDEX "products_packs_locales_locale_parent_id_unique"
      ON "products_packs_locales" USING btree ("_locale", "_parent_id")
  `)

  // Migra dati esistenti → locale IT
  await db.execute(sql`
    INSERT INTO "products_packs_locales" (name, badge_text, _locale, _parent_id)
    SELECT name, badge_text, 'it', id
    FROM "products_packs"
    ON CONFLICT DO NOTHING
  `)
  await db.execute(sql`ALTER TABLE "products_packs" DROP COLUMN IF EXISTS "name"`)
  await db.execute(sql`ALTER TABLE "products_packs" DROP COLUMN IF EXISTS "badge_text"`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS "products_variants_locales" CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS "products_packs_locales" CASCADE`)
  await db.execute(sql`ALTER TABLE "products_variants" ADD COLUMN IF NOT EXISTS "description" varchar`)
  await db.execute(sql`ALTER TABLE "products_packs" ADD COLUMN IF NOT EXISTS "name" varchar NOT NULL DEFAULT ''`)
  await db.execute(sql`ALTER TABLE "products_packs" ADD COLUMN IF NOT EXISTS "badge_text" varchar`)
}
