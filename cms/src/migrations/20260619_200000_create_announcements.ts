import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "announcements" (
      "id" serial PRIMARY KEY NOT NULL,
      "title" varchar NOT NULL,
      "body" varchar,
      "content" varchar,
      "start_date" timestamp with time zone,
      "end_date" timestamp with time zone,
      "active" boolean DEFAULT false NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    )
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "announcements_created_at_idx" ON "announcements" USING btree ("created_at")`)
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "announcements_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_announcements_fk"
        FOREIGN KEY ("announcements_id") REFERENCES "announcements"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_announcements_id_idx" ON "payload_locked_documents_rels" USING btree ("announcements_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "announcements_id"`)
  await db.execute(sql`DROP INDEX IF EXISTS "announcements_created_at_idx"`)
  await db.execute(sql`DROP TABLE IF EXISTS "announcements"`)
}
