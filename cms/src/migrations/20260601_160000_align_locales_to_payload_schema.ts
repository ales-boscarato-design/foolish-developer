import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

/**
 * Allinea le tabelle *_locales allo schema esatto che Payload 3.x genera.
 *
 * Differenze tra le nostre migration manuali e lo schema Payload reale:
 *  - Enum: "enum__locales" → "_locales"
 *  - products_locales.name: nullable → NOT NULL
 *  - Campi array *_locales: nullable → NOT NULL
 *  - Constraint name: *_locale_parent_unique → *_locale_parent_id_unique
 *    (Payload fa ON CONFLICT ON CONSTRAINT con il nome esatto)
 *
 * Strategia: salva i dati in tabelle temp, ricrea tutto con schema corretto, reinserisce.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {

  // ── 1. Salva dati esistenti in products_locales (se ci sono) ──
  // Usa DO block: se la tabella sorgente non esiste (già droppata da run precedente), ignora.
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_products_locales AS SELECT * FROM products_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_fh_locales AS SELECT * FROM products_feature_highlights_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_us_locales AS SELECT * FROM products_usage_steps_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_witb_locales AS SELECT * FROM products_whats_in_the_box_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_attr_locales AS SELECT * FROM products_attributes_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TABLE IF NOT EXISTS _tmp_attropt_locales AS SELECT * FROM products_attributes_options_locales;
    EXCEPTION WHEN undefined_table THEN NULL;
    END $$;
  `)

  // ── 2. Elimina tabelle *_locales esistenti ─────────────────
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_options_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_feature_highlights_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_usage_steps_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_whats_in_the_box_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_locales CASCADE`)

  // ── 3. Elimina enum sbagliato, crea quello corretto ────────
  await db.execute(sql`DROP TYPE IF EXISTS enum__locales CASCADE`)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "_locales" AS ENUM('it', 'en', 'de', 'fr', 'es');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // ── 4. Ricrea tabelle con schema ESATTO di Payload ─────────

  await db.execute(sql`
    CREATE TABLE "products_attributes_options_locales" (
      "label"      varchar NOT NULL,
      "id"         serial PRIMARY KEY NOT NULL,
      "_locale"    "_locales" NOT NULL,
      "_parent_id" varchar NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE "products_attributes_locales" (
      "label"      varchar NOT NULL,
      "id"         serial PRIMARY KEY NOT NULL,
      "_locale"    "_locales" NOT NULL,
      "_parent_id" varchar NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE "products_feature_highlights_locales" (
      "title"       varchar NOT NULL,
      "description" varchar NOT NULL,
      "id"          serial PRIMARY KEY NOT NULL,
      "_locale"     "_locales" NOT NULL,
      "_parent_id"  varchar NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE "products_usage_steps_locales" (
      "title"       varchar NOT NULL,
      "description" varchar NOT NULL,
      "id"          serial PRIMARY KEY NOT NULL,
      "_locale"     "_locales" NOT NULL,
      "_parent_id"  varchar NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE "products_whats_in_the_box_locales" (
      "label"       varchar NOT NULL,
      "description" varchar NOT NULL,
      "id"          serial PRIMARY KEY NOT NULL,
      "_locale"     "_locales" NOT NULL,
      "_parent_id"  varchar NOT NULL
    )
  `)

  await db.execute(sql`
    CREATE TABLE "products_locales" (
      "name"              varchar NOT NULL,
      "short_description" varchar,
      "description"       jsonb,
      "unique_note"       varchar,
      "id"                serial PRIMARY KEY NOT NULL,
      "_locale"           "_locales" NOT NULL,
      "_parent_id"        integer NOT NULL
    )
  `)

  // ── 5. Foreign keys ────────────────────────────────────────
  await db.execute(sql`ALTER TABLE "products_attributes_options_locales" ADD CONSTRAINT "products_attributes_options_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products_attributes_options"("id") ON DELETE cascade ON UPDATE no action`)
  await db.execute(sql`ALTER TABLE "products_attributes_locales" ADD CONSTRAINT "products_attributes_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products_attributes"("id") ON DELETE cascade ON UPDATE no action`)
  await db.execute(sql`ALTER TABLE "products_feature_highlights_locales" ADD CONSTRAINT "products_feature_highlights_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products_feature_highlights"("id") ON DELETE cascade ON UPDATE no action`)
  await db.execute(sql`ALTER TABLE "products_usage_steps_locales" ADD CONSTRAINT "products_usage_steps_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products_usage_steps"("id") ON DELETE cascade ON UPDATE no action`)
  await db.execute(sql`ALTER TABLE "products_whats_in_the_box_locales" ADD CONSTRAINT "products_whats_in_the_box_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products_whats_in_the_box"("id") ON DELETE cascade ON UPDATE no action`)
  await db.execute(sql`ALTER TABLE "products_locales" ADD CONSTRAINT "products_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "products"("id") ON DELETE cascade ON UPDATE no action`)

  // ── 6. Unique indexes (nomi ESATTI attesi da Payload) ──────
  await db.execute(sql`CREATE UNIQUE INDEX "products_attributes_options_locales_locale_parent_id_unique" ON "products_attributes_options_locales" USING btree ("_locale","_parent_id")`)
  await db.execute(sql`CREATE UNIQUE INDEX "products_attributes_locales_locale_parent_id_unique" ON "products_attributes_locales" USING btree ("_locale","_parent_id")`)
  await db.execute(sql`CREATE UNIQUE INDEX "products_feature_highlights_locales_locale_parent_id_unique" ON "products_feature_highlights_locales" USING btree ("_locale","_parent_id")`)
  await db.execute(sql`CREATE UNIQUE INDEX "products_usage_steps_locales_locale_parent_id_unique" ON "products_usage_steps_locales" USING btree ("_locale","_parent_id")`)
  await db.execute(sql`CREATE UNIQUE INDEX "products_whats_in_the_box_locales_locale_parent_id_unique" ON "products_whats_in_the_box_locales" USING btree ("_locale","_parent_id")`)
  await db.execute(sql`CREATE UNIQUE INDEX "products_locales_locale_parent_id_unique" ON "products_locales" USING btree ("_locale","_parent_id")`)

  // ── 7. Reinserisce dati salvati ────────────────────────────
  // products_locales: name era NOT NULL, quindi inseriamo solo righe con name non nullo
  await db.execute(sql`
    INSERT INTO products_locales (name, short_description, description, unique_note, _locale, _parent_id)
    SELECT name, short_description, description, unique_note,
           _locale::text::"_locales",
           _parent_id
    FROM _tmp_products_locales
    WHERE name IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  // Array locales: title/label erano NOT NULL, inseriamo solo righe complete
  await db.execute(sql`
    INSERT INTO products_feature_highlights_locales (title, description, _locale, _parent_id)
    SELECT title, description, _locale::text::"_locales", _parent_id
    FROM _tmp_fh_locales
    WHERE title IS NOT NULL AND description IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO products_usage_steps_locales (title, description, _locale, _parent_id)
    SELECT title, description, _locale::text::"_locales", _parent_id
    FROM _tmp_us_locales
    WHERE title IS NOT NULL AND description IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO products_whats_in_the_box_locales (label, description, _locale, _parent_id)
    SELECT label, description, _locale::text::"_locales", _parent_id
    FROM _tmp_witb_locales
    WHERE label IS NOT NULL AND description IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO products_attributes_locales (label, _locale, _parent_id)
    SELECT label, _locale::text::"_locales", _parent_id
    FROM _tmp_attr_locales
    WHERE label IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  await db.execute(sql`
    INSERT INTO products_attributes_options_locales (label, _locale, _parent_id)
    SELECT label, _locale::text::"_locales", _parent_id
    FROM _tmp_attropt_locales
    WHERE label IS NOT NULL
    ON CONFLICT DO NOTHING
  `)

  // ── 8. Pulizia tabelle temporanee ─────────────────────────
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_products_locales`)
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_fh_locales`)
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_us_locales`)
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_witb_locales`)
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_attr_locales`)
  await db.execute(sql`DROP TABLE IF EXISTS _tmp_attropt_locales`)

  // ── 9. payload_locked_documents_rels — aggiungi colonne mancanti ──
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "pro_members_id" integer`)
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "promo_codes_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pro_members_fk"
        FOREIGN KEY ("pro_members_id") REFERENCES "pro_members"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promo_codes_fk"
        FOREIGN KEY ("promo_codes_id") REFERENCES "promo_codes"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_pro_members_id_idx" ON "payload_locked_documents_rels" USING btree ("pro_members_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_promo_codes_id_idx" ON "payload_locked_documents_rels" USING btree ("promo_codes_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_options_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_attributes_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_feature_highlights_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_usage_steps_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_whats_in_the_box_locales CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS products_locales CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS "_locales"`)
}
