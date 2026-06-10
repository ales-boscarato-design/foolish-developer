import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 1. Trigger enum
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_push_sequences_trigger AS ENUM ('on_subscribe', 'on_order_shipped', 'on_order_delivered', 'manual');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // 2. Main push_sequences table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "push_sequences" (
      "id"          serial PRIMARY KEY,
      "name"        varchar NOT NULL,
      "trigger"     enum_push_sequences_trigger NOT NULL,
      "active"      boolean NOT NULL DEFAULT true,
      "updated_at"  timestamptz(3) NOT NULL DEFAULT now(),
      "created_at"  timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "push_sequences_created_at_idx" ON "push_sequences" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "push_sequences_updated_at_idx" ON "push_sequences" USING btree ("updated_at")`)

  // 3. Steps array table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "push_sequences_steps" (
      "id"           serial PRIMARY KEY,
      "_order"       integer NOT NULL,
      "_parent_id"   integer NOT NULL REFERENCES "push_sequences"("id") ON DELETE cascade ON UPDATE no action,
      "step_key"     varchar NOT NULL,
      "delay_hours"  integer NOT NULL DEFAULT 0,
      "title"        varchar NOT NULL,
      "body"         varchar NOT NULL,
      "url"          varchar DEFAULT '/account',
      "active"       boolean NOT NULL DEFAULT true
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "push_sequences_steps_order_idx" ON "push_sequences_steps" USING btree ("_order")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "push_sequences_steps_parent_id_idx" ON "push_sequences_steps" USING btree ("_parent_id")`)

  // 4. Register in payload_locked_documents_rels
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "push_sequences_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_push_sequences_fk"
        FOREIGN KEY ("push_sequences_id") REFERENCES "push_sequences"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_push_sequences_id_idx" ON "payload_locked_documents_rels" USING btree ("push_sequences_id")`)

  // 5. Seed default on_subscribe sequence
  await db.execute(sql`
    WITH seq AS (
      INSERT INTO "push_sequences" ("name", "trigger", "active")
      VALUES ('Benvenuto all''attivazione', 'on_subscribe', true)
      RETURNING id
    )
    INSERT INTO "push_sequences_steps" ("_order", "_parent_id", "step_key", "delay_hours", "title", "body", "url", "active")
    SELECT 1, seq.id, 'welcome',      0,   'Ciao da Foolish!',       'La tua area clienti è pronta. Traccia ordini, wishlist e risorse.', '/account', true FROM seq
    UNION ALL
    SELECT 2, seq.id, 'discount_48h', 48,  'Un regalo da Frank',     'Usa WELCOME5 al checkout per il 5% sul prossimo ordine.',           '/it',      true FROM seq
    UNION ALL
    SELECT 3, seq.id, 'review_7d',    168, 'Come va la pelle?',      'Hai ricevuto il tuo ordine? Lascia un giudizio, ci aiuta tanto.',   '/account/ordini', true FROM seq;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "push_sequences_id"`)
  await db.execute(sql`DROP TABLE IF EXISTS "push_sequences_steps" CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS "push_sequences" CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_push_sequences_trigger`)
}
