import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE orders
      ADD COLUMN IF NOT EXISTS billing_company_name   varchar,
      ADD COLUMN IF NOT EXISTS billing_vat_number     varchar,
      ADD COLUMN IF NOT EXISTS billing_sdi_code       varchar,
      ADD COLUMN IF NOT EXISTS billing_address_name       varchar,
      ADD COLUMN IF NOT EXISTS billing_address_address1   varchar,
      ADD COLUMN IF NOT EXISTS billing_address_address2   varchar,
      ADD COLUMN IF NOT EXISTS billing_address_city       varchar,
      ADD COLUMN IF NOT EXISTS billing_address_postal_code varchar,
      ADD COLUMN IF NOT EXISTS billing_address_country    varchar,
      ADD COLUMN IF NOT EXISTS billing_same_as_shipping   boolean DEFAULT true
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE orders
      DROP COLUMN IF EXISTS billing_company_name,
      DROP COLUMN IF EXISTS billing_vat_number,
      DROP COLUMN IF EXISTS billing_sdi_code,
      DROP COLUMN IF EXISTS billing_address_name,
      DROP COLUMN IF EXISTS billing_address_address1,
      DROP COLUMN IF EXISTS billing_address_address2,
      DROP COLUMN IF EXISTS billing_address_city,
      DROP COLUMN IF EXISTS billing_address_postal_code,
      DROP COLUMN IF EXISTS billing_address_country,
      DROP COLUMN IF EXISTS billing_same_as_shipping
  `)
}
