import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Corregge la migration 20260601_100000 che usava name_it/name_en sullo stesso record.
 * Payload 3.x postgres adapter usa tabelle _locales separate.
 *
 * Struttura corretta:
 *   products              → solo campi NON localizzati
 *   products_locales      → name, short_description, description, unique_note + _locale + _parent_id
 *   products_*_locales    → stessa cosa per le array tables
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {

  // ── Enum condiviso per le locale ─────────────────────────
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum__locales AS ENUM ('it', 'en', 'de', 'fr', 'es');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // ════════════════════════════════════════════════════════
  // products_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_locales (
      id               serial PRIMARY KEY,
      name             varchar,
      short_description varchar,
      description      jsonb,
      unique_note      varchar,
      _locale          enum__locales NOT NULL,
      _parent_id       integer NOT NULL
        REFERENCES products(id) ON DELETE CASCADE,
      CONSTRAINT products_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_locales_locale_idx    ON products_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_locales_parent_idx    ON products_locales USING btree (_parent_id)`)

  // Migra dati italiani già presenti (da name_it → products_locales)
  await db.execute(sql`
    INSERT INTO products_locales (_locale, _parent_id, name, short_description, description, unique_note)
    SELECT 'it', id, name_it, short_description_it, description_it, unique_note_it
    FROM products
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  // Rimuovi colonne _it/_en/_de/_fr/_es ormai spostate su products_locales
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_it`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS name_es`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_it`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS short_description_es`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_it`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS description_es`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_it`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_en`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_de`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_fr`)
  await db.execute(sql`ALTER TABLE products DROP COLUMN IF EXISTS unique_note_es`)

  // ════════════════════════════════════════════════════════
  // products_feature_highlights_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_feature_highlights_locales (
      id          serial PRIMARY KEY,
      title       varchar,
      description varchar,
      _locale     enum__locales NOT NULL,
      _parent_id  varchar NOT NULL
        REFERENCES products_feature_highlights(id) ON DELETE CASCADE,
      CONSTRAINT products_fh_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_fh_locales_locale_idx  ON products_feature_highlights_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_fh_locales_parent_idx  ON products_feature_highlights_locales USING btree (_parent_id)`)

  await db.execute(sql`
    INSERT INTO products_feature_highlights_locales (_locale, _parent_id, title, description)
    SELECT 'it', id, title_it, description_it
    FROM products_feature_highlights
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_it`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_en`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_de`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_fr`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS title_es`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_it`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_feature_highlights DROP COLUMN IF EXISTS description_es`)

  // ════════════════════════════════════════════════════════
  // products_usage_steps_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_usage_steps_locales (
      id          serial PRIMARY KEY,
      title       varchar,
      description varchar,
      _locale     enum__locales NOT NULL,
      _parent_id  varchar NOT NULL
        REFERENCES products_usage_steps(id) ON DELETE CASCADE,
      CONSTRAINT products_us_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_us_locales_locale_idx  ON products_usage_steps_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_us_locales_parent_idx  ON products_usage_steps_locales USING btree (_parent_id)`)

  await db.execute(sql`
    INSERT INTO products_usage_steps_locales (_locale, _parent_id, title, description)
    SELECT 'it', id, title_it, description_it
    FROM products_usage_steps
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_it`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_en`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_de`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_fr`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS title_es`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_it`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_usage_steps DROP COLUMN IF EXISTS description_es`)

  // ════════════════════════════════════════════════════════
  // products_whats_in_the_box_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_whats_in_the_box_locales (
      id          serial PRIMARY KEY,
      label       varchar,
      description varchar,
      _locale     enum__locales NOT NULL,
      _parent_id  varchar NOT NULL
        REFERENCES products_whats_in_the_box(id) ON DELETE CASCADE,
      CONSTRAINT products_witb_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_witb_locales_locale_idx  ON products_whats_in_the_box_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_witb_locales_parent_idx  ON products_whats_in_the_box_locales USING btree (_parent_id)`)

  await db.execute(sql`
    INSERT INTO products_whats_in_the_box_locales (_locale, _parent_id, label, description)
    SELECT 'it', id, label_it, description_it
    FROM products_whats_in_the_box
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_it`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS label_es`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_it`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_en`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_de`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_fr`)
  await db.execute(sql`ALTER TABLE products_whats_in_the_box DROP COLUMN IF EXISTS description_es`)

  // ════════════════════════════════════════════════════════
  // products_attributes_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_attributes_locales (
      id         serial PRIMARY KEY,
      label      varchar,
      _locale    enum__locales NOT NULL,
      _parent_id varchar NOT NULL
        REFERENCES products_attributes(id) ON DELETE CASCADE,
      CONSTRAINT products_attr_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_attr_locales_locale_idx  ON products_attributes_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_attr_locales_parent_idx  ON products_attributes_locales USING btree (_parent_id)`)

  await db.execute(sql`
    INSERT INTO products_attributes_locales (_locale, _parent_id, label)
    SELECT 'it', id, label_it
    FROM products_attributes
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_it`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_attributes DROP COLUMN IF EXISTS label_es`)

  // ════════════════════════════════════════════════════════
  // products_attributes_options_locales
  // ════════════════════════════════════════════════════════
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS products_attributes_options_locales (
      id         serial PRIMARY KEY,
      label      varchar,
      _locale    enum__locales NOT NULL,
      _parent_id varchar NOT NULL
        REFERENCES products_attributes_options(id) ON DELETE CASCADE,
      CONSTRAINT products_attropt_locales_locale_parent_unique UNIQUE (_locale, _parent_id)
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_attropt_locales_locale_idx  ON products_attributes_options_locales USING btree (_locale)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS products_attropt_locales_parent_idx  ON products_attributes_options_locales USING btree (_parent_id)`)

  await db.execute(sql`
    INSERT INTO products_attributes_options_locales (_locale, _parent_id, label)
    SELECT 'it', id, label_it
    FROM products_attributes_options
    ON CONFLICT (_locale, _parent_id) DO NOTHING
  `)

  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_it`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_en`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_de`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_fr`)
  await db.execute(sql`ALTER TABLE products_attributes_options DROP COLUMN IF EXISTS label_es`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_options_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_whats_in_the_box_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_usage_steps_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_feature_highlights_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_locales CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum__locales`)
}
