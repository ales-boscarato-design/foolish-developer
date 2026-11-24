import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_orders_attribution_source_class" AS ENUM ('direct', 'organicSearch', 'paidAds', 'organicSocial', 'referral', 'llm', 'unknown');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "attribution_landing_path" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_referrer_host" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_utm_source" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_utm_medium" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_utm_campaign" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_utm_term" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_utm_content" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_ref_slug" varchar,
      ADD COLUMN IF NOT EXISTS "attribution_source_class" "enum_orders_attribution_source_class"
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "attribution_landing_path",
      DROP COLUMN IF EXISTS "attribution_referrer_host",
      DROP COLUMN IF EXISTS "attribution_utm_source",
      DROP COLUMN IF EXISTS "attribution_utm_medium",
      DROP COLUMN IF EXISTS "attribution_utm_campaign",
      DROP COLUMN IF EXISTS "attribution_utm_term",
      DROP COLUMN IF EXISTS "attribution_utm_content",
      DROP COLUMN IF EXISTS "attribution_ref_slug",
      DROP COLUMN IF EXISTS "attribution_source_class"
  `)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_orders_attribution_source_class"`)
}
