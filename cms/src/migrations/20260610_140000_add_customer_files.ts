import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // 1. Create enum for file type
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_customer_files_file_type AS ENUM ('guide', 'video', 'resource');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // 2. Create customer_files table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "customer_files" (
      "id"           serial PRIMARY KEY,
      "title"        varchar NOT NULL,
      "file_id"      integer REFERENCES "media"("id") ON DELETE set null ON UPDATE no action,
      "customer_id"  integer REFERENCES "customers"("id") ON DELETE set null ON UPDATE no action,
      "file_type"    enum_customer_files_file_type NOT NULL,
      "active"       boolean NOT NULL DEFAULT true,
      "updated_at"   timestamptz(3) NOT NULL DEFAULT now(),
      "created_at"   timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "customer_files_created_at_idx" ON "customer_files" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "customer_files_updated_at_idx" ON "customer_files" USING btree ("updated_at")`)

  // 3. Add customer_files_id to payload_locked_documents_rels
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "customer_files_id" integer`)
  await db.execute(sql`
    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_customer_files_fk"
        FOREIGN KEY ("customer_files_id") REFERENCES "customer_files"("id") ON DELETE cascade ON UPDATE no action;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_customer_files_id_idx" ON "payload_locked_documents_rels" USING btree ("customer_files_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "customer_files_id"`)
  await db.execute(sql`DROP TABLE IF EXISTS "customer_files" CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_customer_files_file_type`)
}
