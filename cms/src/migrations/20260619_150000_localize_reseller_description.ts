import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Add reseller_description to the locales table (Payload stores localized fields per-locale row)
  await db.execute(sql`ALTER TABLE "products_locales" ADD COLUMN IF NOT EXISTS "reseller_description" varchar`)

  // Migrate existing Italian data from products.reseller_description (old non-localized column)
  // to products_locales.reseller_description where _locale = 'it'
  await db.execute(sql`
    UPDATE "products_locales" pl
    SET "reseller_description" = p."reseller_description"
    FROM "products" p
    WHERE pl."_parent_id" = p.id
      AND pl."_locale" = 'it'
      AND p."reseller_description" IS NOT NULL
  `)

  // Drop the old non-localized column from products
  await db.execute(sql`ALTER TABLE "products" DROP COLUMN IF EXISTS "reseller_description"`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  // Restore the original non-localized column
  await db.execute(sql`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "reseller_description" varchar`)

  // Copy Italian data back
  await db.execute(sql`
    UPDATE "products" p
    SET "reseller_description" = pl."reseller_description"
    FROM "products_locales" pl
    WHERE pl."_parent_id" = p.id
      AND pl."_locale" = 'it'
      AND pl."reseller_description" IS NOT NULL
  `)

  // Remove from locales table
  await db.execute(sql`ALTER TABLE "products_locales" DROP COLUMN IF EXISTS "reseller_description"`)
}
