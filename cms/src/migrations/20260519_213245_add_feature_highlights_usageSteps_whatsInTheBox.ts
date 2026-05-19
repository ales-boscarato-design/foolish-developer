import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // Feature highlights — enum + table
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."enum_products_feature_highlights_icon" AS ENUM('sparkles', 'shield', 'star', 'truck');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `)

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_feature_highlights" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "icon" "enum_products_feature_highlights_icon" NOT NULL,
      "title" varchar NOT NULL,
      "description" varchar NOT NULL
    );
  `)

  // Usage steps — table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_usage_steps" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "step" varchar NOT NULL,
      "title" varchar NOT NULL,
      "description" varchar NOT NULL
    );
  `)

  // What's in the box — table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "products_whats_in_the_box" (
      "_order" integer NOT NULL,
      "_parent_id" integer NOT NULL,
      "id" varchar PRIMARY KEY NOT NULL,
      "label" varchar NOT NULL,
      "description" varchar NOT NULL
    );
  `)

  // Indexes
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "products_feature_highlights_order_idx" ON "products_feature_highlights" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "products_feature_highlights_parent_id_idx" ON "products_feature_highlights" USING btree ("_parent_id");
    CREATE INDEX IF NOT EXISTS "products_usage_steps_order_idx" ON "products_usage_steps" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "products_usage_steps_parent_id_idx" ON "products_usage_steps" USING btree ("_parent_id");
    CREATE INDEX IF NOT EXISTS "products_whats_in_the_box_order_idx" ON "products_whats_in_the_box" USING btree ("_order");
    CREATE INDEX IF NOT EXISTS "products_whats_in_the_box_parent_id_idx" ON "products_whats_in_the_box" USING btree ("_parent_id");
  `)

  // Foreign keys
  await db.execute(sql`
    ALTER TABLE "products_feature_highlights" ADD CONSTRAINT "products_feature_highlights_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "products_usage_steps" ADD CONSTRAINT "products_usage_steps_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
    ALTER TABLE "products_whats_in_the_box" ADD CONSTRAINT "products_whats_in_the_box_parent_id_fk"
      FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TABLE IF EXISTS "products_feature_highlights" CASCADE;
    DROP TABLE IF EXISTS "products_usage_steps" CASCADE;
    DROP TABLE IF EXISTS "products_whats_in_the_box" CASCADE;
    DROP TYPE IF EXISTS "public"."enum_products_feature_highlights_icon";
  `)
}