import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Enum types (PostgreSQL doesn't support IF NOT EXISTS for CREATE TYPE)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_subscription_plans_key" AS ENUM ('tattoo', 'pmu');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_subscriptions_plan" AS ENUM ('tattoo', 'pmu');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_subscriptions_zone" AS ENUM ('IT', 'EU');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_subscriptions_status" AS ENUM ('active', 'canceling', 'canceled');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  // Orders: nuova opzione 'subscription' sul campo source esistente (Task 3)
  await db.execute(sql`ALTER TYPE "public"."enum_orders_source" ADD VALUE IF NOT EXISTS 'subscription'`)

  // Fix opportunistico: 'reseller' fu aggiunta alle options del campo source in
  // 20260617_100000_add_reseller_fields.ts ma mai all'enum Postgres reale (quella
  // migration assumeva erroneamente che source fosse testo libero). Aggiunta qui
  // perché stiamo già alterando lo stesso tipo enum.
  await db.execute(sql`ALTER TYPE "public"."enum_orders_source" ADD VALUE IF NOT EXISTS 'reseller'`)

  // subscription_plans table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "subscription_plans" (
      "id"         serial PRIMARY KEY,
      "key"        "enum_subscription_plans_key" NOT NULL,
      "product_id" integer NOT NULL REFERENCES products(id),
      "active"     boolean NOT NULL DEFAULT true,
      "updated_at" timestamptz(3) NOT NULL DEFAULT now(),
      "created_at" timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_key_idx" ON "subscription_plans" USING btree ("key")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscription_plans_product_idx" ON "subscription_plans" USING btree ("product_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscription_plans_created_at_idx" ON "subscription_plans" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscription_plans_updated_at_idx" ON "subscription_plans" USING btree ("updated_at")`)

  // subscriptions table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "subscriptions" (
      "id"                     serial PRIMARY KEY,
      "customer_email"         varchar NOT NULL,
      "plan"                   "enum_subscriptions_plan" NOT NULL,
      "zone"                   "enum_subscriptions_zone" NOT NULL,
      "stripe_subscription_id" varchar NOT NULL,
      "stripe_schedule_id"     varchar,
      "status"                 "enum_subscriptions_status" NOT NULL DEFAULT 'active',
      "cycles_completed"       numeric DEFAULT 0,
      "started_at"             timestamptz(3),
      "canceled_at"            timestamptz(3),
      "updated_at"             timestamptz(3) NOT NULL DEFAULT now(),
      "created_at"             timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_stripe_subscription_id_idx" ON "subscriptions" USING btree ("stripe_subscription_id")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscriptions_customer_email_idx" ON "subscriptions" USING btree ("customer_email")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscriptions_created_at_idx" ON "subscriptions" USING btree ("created_at")`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "subscriptions_updated_at_idx" ON "subscriptions" USING btree ("updated_at")`)

  // Registra le due collection in payload_locked_documents_rels (come ogni collection Payload)
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "subscription_plans_id" integer`)
  try {
    await db.execute(sql`
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_subscription_plans_fk"
        FOREIGN KEY ("subscription_plans_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE
    `)
  } catch { /* constraint may already exist */ }
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_subscription_plans_id_idx" ON "payload_locked_documents_rels" USING btree ("subscription_plans_id")`)

  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" ADD COLUMN IF NOT EXISTS "subscriptions_id" integer`)
  try {
    await db.execute(sql`
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_subscriptions_fk"
        FOREIGN KEY ("subscriptions_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE
    `)
  } catch { /* constraint may already exist */ }
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_subscriptions_id_idx" ON "payload_locked_documents_rels" USING btree ("subscriptions_id")`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "subscription_plans_id"`)
  await db.execute(sql`ALTER TABLE "payload_locked_documents_rels" DROP COLUMN IF EXISTS "subscriptions_id"`)
  await db.execute(sql`DROP TABLE IF EXISTS "subscriptions" CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS "subscription_plans" CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_subscription_plans_key"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_subscriptions_plan"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_subscriptions_zone"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_subscriptions_status"`)
  // Postgres non supporta la rimozione di un valore enum senza ricreare il tipo.
  // 'subscription' resta in enum_orders_source anche dopo il rollback.
}
