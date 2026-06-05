import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Payload CMS expects array table columns named _parent_id and _order (underscore prefix).
// The original migration created them as parent_id and order, causing 500 on GET /api/orders.

export async function up({ db }: MigrateUpArgs): Promise<void> {
  // orders_sheet_photos
  await db.execute(sql`ALTER TABLE "orders_sheet_photos" RENAME COLUMN "order" TO "_order"`)
  await db.execute(sql`ALTER TABLE "orders_sheet_photos" RENAME COLUMN "parent_id" TO "_parent_id"`)

  // orders_content_blocks
  await db.execute(sql`ALTER TABLE "orders_content_blocks" RENAME COLUMN "order" TO "_order"`)
  await db.execute(sql`ALTER TABLE "orders_content_blocks" RENAME COLUMN "parent_id" TO "_parent_id"`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`ALTER TABLE "orders_sheet_photos" RENAME COLUMN "_order" TO "order"`)
  await db.execute(sql`ALTER TABLE "orders_sheet_photos" RENAME COLUMN "_parent_id" TO "parent_id"`)
  await db.execute(sql`ALTER TABLE "orders_content_blocks" RENAME COLUMN "_order" TO "order"`)
  await db.execute(sql`ALTER TABLE "orders_content_blocks" RENAME COLUMN "_parent_id" TO "parent_id"`)
}
