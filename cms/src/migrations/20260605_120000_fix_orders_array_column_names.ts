import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Payload CMS expects array table columns named _parent_id and _order (underscore prefix).
// The original migration created them as parent_id and order, causing 500 on GET /api/orders.
// NOTE: already applied manually on production DB — guard with existence check.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_sheet_photos' AND column_name = 'order'
      ) THEN
        ALTER TABLE "orders_sheet_photos" RENAME COLUMN "order" TO "_order";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_sheet_photos' AND column_name = 'parent_id'
      ) THEN
        ALTER TABLE "orders_sheet_photos" RENAME COLUMN "parent_id" TO "_parent_id";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_content_blocks' AND column_name = 'order'
      ) THEN
        ALTER TABLE "orders_content_blocks" RENAME COLUMN "order" TO "_order";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_content_blocks' AND column_name = 'parent_id'
      ) THEN
        ALTER TABLE "orders_content_blocks" RENAME COLUMN "parent_id" TO "_parent_id";
      END IF;
    END $$;
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_sheet_photos' AND column_name = '_order'
      ) THEN
        ALTER TABLE "orders_sheet_photos" RENAME COLUMN "_order" TO "order";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_sheet_photos' AND column_name = '_parent_id'
      ) THEN
        ALTER TABLE "orders_sheet_photos" RENAME COLUMN "_parent_id" TO "parent_id";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_content_blocks' AND column_name = '_order'
      ) THEN
        ALTER TABLE "orders_content_blocks" RENAME COLUMN "_order" TO "order";
      END IF;
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders_content_blocks' AND column_name = '_parent_id'
      ) THEN
        ALTER TABLE "orders_content_blocks" RENAME COLUMN "_parent_id" TO "parent_id";
      END IF;
    END $$;
  `)
}
