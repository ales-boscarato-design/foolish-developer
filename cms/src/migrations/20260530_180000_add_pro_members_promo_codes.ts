import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_pro_members_status AS ENUM ('active', 'suspended');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE enum_promo_codes_type AS ENUM ('free_shipping', 'percent_pro');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS pro_members (
      id             serial PRIMARY KEY,
      vat_number     varchar NOT NULL,
      business_name  varchar NOT NULL,
      contact_name   varchar NOT NULL,
      email          varchar NOT NULL,
      telegram_id    varchar,
      discount_code  varchar NOT NULL,
      status         enum_pro_members_status NOT NULL DEFAULT 'active',
      channel_invited boolean NOT NULL DEFAULT false,
      total_spent    numeric DEFAULT 0,
      order_count    numeric DEFAULT 0,
      notes          varchar,
      joined_at      timestamptz(3),
      updated_at     timestamptz(3) NOT NULL DEFAULT now(),
      created_at     timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pro_members_vat_number_idx    ON pro_members USING btree (vat_number)`)
  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS pro_members_discount_code_idx  ON pro_members USING btree (discount_code)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pro_members_created_at_idx            ON pro_members USING btree (created_at)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS pro_members_updated_at_idx            ON pro_members USING btree (updated_at)`)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS promo_codes (
      id              serial PRIMARY KEY,
      code            varchar NOT NULL,
      type            enum_promo_codes_type NOT NULL,
      active          boolean NOT NULL DEFAULT true,
      pro_member_id   integer REFERENCES pro_members(id) ON DELETE SET NULL,
      usage_count     numeric DEFAULT 0,
      updated_at      timestamptz(3) NOT NULL DEFAULT now(),
      created_at      timestamptz(3) NOT NULL DEFAULT now()
    )
  `)

  await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_code_idx         ON promo_codes USING btree (code)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS promo_codes_created_at_idx           ON promo_codes USING btree (created_at)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS promo_codes_updated_at_idx           ON promo_codes USING btree (updated_at)`)
  await db.execute(sql`CREATE INDEX IF NOT EXISTS promo_codes_pro_member_idx           ON promo_codes USING btree (pro_member_id)`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP TABLE IF EXISTS promo_codes CASCADE`)
  await db.execute(sql`DROP TABLE IF EXISTS pro_members CASCADE`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_promo_codes_type`)
  await db.execute(sql`DROP TYPE IF EXISTS enum_pro_members_status`)
}
