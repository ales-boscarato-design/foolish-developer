import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."_locales" AS ENUM('it', 'en', 'de', 'fr', 'es');
  CREATE TYPE "public"."enum_orders_content_blocks_type" AS ENUM('guide', 'announcement', 'offer', 'tip');
  CREATE TYPE "public"."enum_pro_members_status" AS ENUM('active', 'suspended');
  CREATE TYPE "public"."enum_promo_codes_type" AS ENUM('free_shipping', 'percent_pro');
  CREATE TABLE "products_attributes_options_locales" (
  	"label" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "products_attributes_locales" (
  	"label" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "products_feature_highlights_locales" (
  	"title" varchar NOT NULL,
  	"description" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "products_usage_steps_locales" (
  	"title" varchar NOT NULL,
  	"description" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "products_whats_in_the_box_locales" (
  	"label" varchar NOT NULL,
  	"description" varchar NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" varchar NOT NULL
  );
  
  CREATE TABLE "products_locales" (
  	"name" varchar NOT NULL,
  	"short_description" varchar,
  	"description" jsonb,
  	"unique_note" varchar,
  	"id" serial PRIMARY KEY NOT NULL,
  	"_locale" "_locales" NOT NULL,
  	"_parent_id" integer NOT NULL
  );
  
  CREATE TABLE "products_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"products_id" integer
  );
  
  CREATE TABLE "orders_sheet_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"url" varchar NOT NULL,
  	"caption" varchar
  );
  
  CREATE TABLE "orders_content_blocks" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"type" "enum_orders_content_blocks_type" NOT NULL,
  	"title" varchar NOT NULL,
  	"body" varchar NOT NULL,
  	"cta_label" varchar,
  	"cta_url" varchar,
  	"active" boolean DEFAULT true,
  	"expires_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "pro_members" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"vat_number" varchar NOT NULL,
  	"business_name" varchar NOT NULL,
  	"contact_name" varchar NOT NULL,
  	"email" varchar NOT NULL,
  	"telegram_id" varchar,
  	"discount_code" varchar NOT NULL,
  	"status" "enum_pro_members_status" DEFAULT 'active' NOT NULL,
  	"channel_invited" boolean DEFAULT false,
  	"total_spent" numeric DEFAULT 0,
  	"order_count" numeric DEFAULT 0,
  	"notes" varchar,
  	"joined_at" timestamp(3) with time zone NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "promo_codes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"type" "enum_promo_codes_type" NOT NULL,
  	"active" boolean DEFAULT true,
  	"pro_member_id" integer,
  	"usage_count" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "orders" ADD COLUMN "customer_locale" varchar;
  ALTER TABLE "orders" ADD COLUMN "page_token" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pro_members_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "promo_codes_id" integer;
  ALTER TABLE "products_attributes_options_locales" ADD CONSTRAINT "products_attributes_options_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_attributes_options"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_attributes_locales" ADD CONSTRAINT "products_attributes_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_attributes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_feature_highlights_locales" ADD CONSTRAINT "products_feature_highlights_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_feature_highlights"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_usage_steps_locales" ADD CONSTRAINT "products_usage_steps_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_usage_steps"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_whats_in_the_box_locales" ADD CONSTRAINT "products_whats_in_the_box_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products_whats_in_the_box"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_locales" ADD CONSTRAINT "products_locales_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_rels" ADD CONSTRAINT "products_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "orders_sheet_photos" ADD CONSTRAINT "orders_sheet_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "orders_content_blocks" ADD CONSTRAINT "orders_content_blocks_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "promo_codes" ADD CONSTRAINT "promo_codes_pro_member_id_pro_members_id_fk" FOREIGN KEY ("pro_member_id") REFERENCES "public"."pro_members"("id") ON DELETE set null ON UPDATE no action;
  CREATE UNIQUE INDEX "products_attributes_options_locales_locale_parent_id_unique" ON "products_attributes_options_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "products_attributes_locales_locale_parent_id_unique" ON "products_attributes_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "products_feature_highlights_locales_locale_parent_id_unique" ON "products_feature_highlights_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "products_usage_steps_locales_locale_parent_id_unique" ON "products_usage_steps_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "products_whats_in_the_box_locales_locale_parent_id_unique" ON "products_whats_in_the_box_locales" USING btree ("_locale","_parent_id");
  CREATE UNIQUE INDEX "products_locales_locale_parent_id_unique" ON "products_locales" USING btree ("_locale","_parent_id");
  CREATE INDEX "products_rels_order_idx" ON "products_rels" USING btree ("order");
  CREATE INDEX "products_rels_parent_idx" ON "products_rels" USING btree ("parent_id");
  CREATE INDEX "products_rels_path_idx" ON "products_rels" USING btree ("path");
  CREATE INDEX "products_rels_products_id_idx" ON "products_rels" USING btree ("products_id");
  CREATE INDEX "orders_sheet_photos_order_idx" ON "orders_sheet_photos" USING btree ("_order");
  CREATE INDEX "orders_sheet_photos_parent_id_idx" ON "orders_sheet_photos" USING btree ("_parent_id");
  CREATE INDEX "orders_content_blocks_order_idx" ON "orders_content_blocks" USING btree ("_order");
  CREATE INDEX "orders_content_blocks_parent_id_idx" ON "orders_content_blocks" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "pro_members_vat_number_idx" ON "pro_members" USING btree ("vat_number");
  CREATE UNIQUE INDEX "pro_members_discount_code_idx" ON "pro_members" USING btree ("discount_code");
  CREATE INDEX "pro_members_updated_at_idx" ON "pro_members" USING btree ("updated_at");
  CREATE INDEX "pro_members_created_at_idx" ON "pro_members" USING btree ("created_at");
  CREATE UNIQUE INDEX "promo_codes_code_idx" ON "promo_codes" USING btree ("code");
  CREATE INDEX "promo_codes_pro_member_idx" ON "promo_codes" USING btree ("pro_member_id");
  CREATE INDEX "promo_codes_updated_at_idx" ON "promo_codes" USING btree ("updated_at");
  CREATE INDEX "promo_codes_created_at_idx" ON "promo_codes" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pro_members_fk" FOREIGN KEY ("pro_members_id") REFERENCES "public"."pro_members"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_promo_codes_fk" FOREIGN KEY ("promo_codes_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "orders_page_token_idx" ON "orders" USING btree ("page_token");
  CREATE INDEX "payload_locked_documents_rels_pro_members_id_idx" ON "payload_locked_documents_rels" USING btree ("pro_members_id");
  CREATE INDEX "payload_locked_documents_rels_promo_codes_id_idx" ON "payload_locked_documents_rels" USING btree ("promo_codes_id");
  ALTER TABLE "products_attributes_options" DROP COLUMN "label";
  ALTER TABLE "products_attributes" DROP COLUMN "label";
  ALTER TABLE "products_feature_highlights" DROP COLUMN "title";
  ALTER TABLE "products_feature_highlights" DROP COLUMN "description";
  ALTER TABLE "products_usage_steps" DROP COLUMN "title";
  ALTER TABLE "products_usage_steps" DROP COLUMN "description";
  ALTER TABLE "products_whats_in_the_box" DROP COLUMN "label";
  ALTER TABLE "products_whats_in_the_box" DROP COLUMN "description";
  ALTER TABLE "products" DROP COLUMN "name";
  ALTER TABLE "products" DROP COLUMN "short_description";
  ALTER TABLE "products" DROP COLUMN "description";
  ALTER TABLE "products" DROP COLUMN "unique_note";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "products_attributes_options_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_attributes_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_feature_highlights_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_usage_steps_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_whats_in_the_box_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_locales" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "products_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders_sheet_photos" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders_content_blocks" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pro_members" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "promo_codes" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "products_attributes_options_locales" CASCADE;
  DROP TABLE "products_attributes_locales" CASCADE;
  DROP TABLE "products_feature_highlights_locales" CASCADE;
  DROP TABLE "products_usage_steps_locales" CASCADE;
  DROP TABLE "products_whats_in_the_box_locales" CASCADE;
  DROP TABLE "products_locales" CASCADE;
  DROP TABLE "products_rels" CASCADE;
  DROP TABLE "orders_sheet_photos" CASCADE;
  DROP TABLE "orders_content_blocks" CASCADE;
  DROP TABLE "pro_members" CASCADE;
  DROP TABLE "promo_codes" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pro_members_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_promo_codes_fk";
  
  DROP INDEX "orders_page_token_idx";
  DROP INDEX "payload_locked_documents_rels_pro_members_id_idx";
  DROP INDEX "payload_locked_documents_rels_promo_codes_id_idx";
  ALTER TABLE "products_attributes_options" ADD COLUMN "label" varchar NOT NULL;
  ALTER TABLE "products_attributes" ADD COLUMN "label" varchar NOT NULL;
  ALTER TABLE "products_feature_highlights" ADD COLUMN "title" varchar NOT NULL;
  ALTER TABLE "products_feature_highlights" ADD COLUMN "description" varchar NOT NULL;
  ALTER TABLE "products_usage_steps" ADD COLUMN "title" varchar NOT NULL;
  ALTER TABLE "products_usage_steps" ADD COLUMN "description" varchar NOT NULL;
  ALTER TABLE "products_whats_in_the_box" ADD COLUMN "label" varchar NOT NULL;
  ALTER TABLE "products_whats_in_the_box" ADD COLUMN "description" varchar NOT NULL;
  ALTER TABLE "products" ADD COLUMN "name" varchar NOT NULL;
  ALTER TABLE "products" ADD COLUMN "short_description" varchar;
  ALTER TABLE "products" ADD COLUMN "description" jsonb;
  ALTER TABLE "products" ADD COLUMN "unique_note" varchar;
  ALTER TABLE "orders" DROP COLUMN "customer_locale";
  ALTER TABLE "orders" DROP COLUMN "page_token";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pro_members_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "promo_codes_id";
  DROP TYPE "public"."_locales";
  DROP TYPE "public"."enum_orders_content_blocks_type";
  DROP TYPE "public"."enum_pro_members_status";
  DROP TYPE "public"."enum_promo_codes_type";`)
}
