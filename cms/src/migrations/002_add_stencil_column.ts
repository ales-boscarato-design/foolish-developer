import { Migration } from '@payloadcms/db-postgres'

export const addStencilColumn: Migration = {
  async up({ db }) {
    await db.execute(sql`
      ALTER TABLE products_variants_valid_combinations 
      ADD COLUMN IF NOT EXISTS stencil text;
    `)
  },
}
