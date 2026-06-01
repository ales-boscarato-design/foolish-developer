import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {

  // ── products — top-level text fields ─────────────────────

  // name (varchar NOT NULL) → name_it + name_en/de/fr/es
  await db.execute(sql`ALTER TABLE products RENAME COLUMN name TO name_it`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_en varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_de varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_fr varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS name_es varchar`)

  // short_description → short_description_it + extra locales
  await db.execute(sql`ALTER TABLE products RENAME COLUMN short_description TO short_description_it`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description_en varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description_de varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description_fr varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS short_description_es varchar`)

  // description (jsonb — richText lexical) → description_it + extra locales
  await db.execute(sql`ALTER TABLE products RENAME COLUMN description TO description_it`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_en jsonb`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_de jsonb`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_fr jsonb`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS description_es jsonb`)

  // unique_note (varchar) → unique_note_it + extra locales
  await db.execute(sql`ALTER TABLE products RENAME COLUMN unique_note TO unique_note_it`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unique_note_en varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unique_note_de varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unique_note_fr varchar`)
  await db.execute(sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS unique_note_es varchar`)

  // ── products_feature_highlights ───────────────────────────

  await db.execute(sql`ALTER TABLE products_feature_highlights RENAME COLUMN title TO title_it`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS title_en varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS title_de varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS title_fr varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS title_es varchar`)

  await db.execute(sql`ALTER TABLE products_feature_highlights RENAME COLUMN description TO description_it`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS description_en varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS description_de varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS description_fr varchar`)
  await db.execute(sql`ALTER TABLE products_feature_highlights ADD COLUMN IF NOT EXISTS description_es varchar`)

  // ── products_usage_steps ──────────────────────────────────

  await db.execute(sql`ALTER TABLE products_usage_steps RENAME COLUMN title TO title_it`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS title_en varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS title_de varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS title_fr varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS title_es varchar`)

  await db.execute(sql`ALTER TABLE products_usage_steps RENAME COLUMN description TO description_it`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS description_en varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS description_de varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS description_fr varchar`)
  await db.execute(sql`ALTER TABLE products_usage_steps ADD COLUMN IF NOT EXISTS description_es varchar`)

  // ── products_whats_in_the_box ─────────────────────────────

  await db.execute(sql`ALTER TABLE products_whats_in_the_box RENAME COLUMN label TO label_it`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS label_en varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS label_de varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS label_fr varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS label_es varchar`)

  await db.execute(sql`ALTER TABLE products_whats_in_the_box RENAME COLUMN description TO description_it`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS description_en varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS description_de varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS description_fr varchar`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box ADD COLUMN IF NOT EXISTS description_es varchar`)

  // ── products_attributes ───────────────────────────────────

  await db.execute(sql`ALTER TABLE products_attributes RENAME COLUMN label TO label_it`)
  await db.execute(sql`ALTER TABLE products_attributes ADD COLUMN IF NOT EXISTS label_en varchar`)
  await db.execute(sql`ALTER TABLE products_attributes ADD COLUMN IF NOT EXISTS label_de varchar`)
  await db.execute(sql`ALTER TABLE products_attributes ADD COLUMN IF NOT EXISTS label_fr varchar`)
  await db.execute(sql`ALTER TABLE products_attributes ADD COLUMN IF NOT EXISTS label_es varchar`)

  // ── products_attributes_options ───────────────────────────

  await db.execute(sql`ALTER TABLE products_attributes_options RENAME COLUMN label TO label_it`)
  await db.execute(sql`ALTER TABLE products_attributes_options ADD COLUMN IF NOT EXISTS label_en varchar`)
  await db.execute(sql`ALTER TABLE products_attributes_options ADD COLUMN IF NOT EXISTS label_de varchar`)
  await db.execute(sql`ALTER TABLE products_attributes_options ADD COLUMN IF NOT EXISTS label_fr varchar`)
  await db.execute(sql`ALTER TABLE products_attributes_options ADD COLUMN IF NOT EXISTS label_es varchar`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {

  // ── products ──────────────────────────────────────────────
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_es`)
  await db.execute(sql`ALTER TABLE products RENAME COLUMN name_it TO name`)

  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_es`)
  await db.execute(sql`ALTER TABLE products RENAME COLUMN short_description_it TO short_description`)

  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_es`)
  await db.execute(sql`ALTER TABLE products RENAME COLUMN description_it TO description`)

  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_es`)
  await db.execute(sql`ALTER TABLE products RENAME COLUMN unique_note_it TO unique_note`)

  // ── array tables ──────────────────────────────────────────
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_en`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_de`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_fr`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_es`)
  await db.execute(sql`ALTER TABLE products_feature_highlights RENAME COLUMN title_it TO title`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_es`)
  await db.execute(sql`ALTER TABLE products_feature_highlights RENAME COLUMN description_it TO description`)

  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_en`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_de`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_fr`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_es`)
  await db.execute(sql`ALTER TABLE products_usage_steps RENAME COLUMN title_it TO title`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_es`)
  await db.execute(sql`ALTER TABLE products_usage_steps RENAME COLUMN description_it TO description`)

  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_es`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box RENAME COLUMN label_it TO label`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_es`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box RENAME COLUMN description_it TO description`)

  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_es`)
  await db.execute(sql`ALTER TABLE products_attributes RENAME COLUMN label_it TO label`)

  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_es`)
  await db.execute(sql`ALTER TABLE products_attributes_options RENAME COLUMN label_it TO label`)
}
