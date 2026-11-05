import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Visibilita dei media: `public` (catalogo, sito) o `private` (documento di un cliente).
 *
 * La colonna e' additiva e NOT NULL con default `public`: i record esistenti restano
 * pubblici come prima, quindi il catalogo e le immagini prodotto non cambiano
 * comportamento. Il valore `private` viene scritto dall'hook della collection
 * `customer-files` quando il file e' collegato a un cliente.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "enum_media_visibility" AS ENUM ('public', 'private');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)

  await db.execute(sql`
    ALTER TABLE "media"
      ADD COLUMN IF NOT EXISTS "visibility" "enum_media_visibility" NOT NULL DEFAULT 'public'
  `)

  await db.execute(sql`
    UPDATE "media" SET "visibility" = 'public' WHERE "visibility" IS NULL
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "media_visibility_idx" ON "media" USING btree ("visibility")
  `)
}

/**
 * Rollback: si perde l'informazione di visibilita' (i documenti privati tornerebbero
 * indistinguibili da quelli pubblici lato schema). L'hook di `customer-files` continua a
 * scrivere il campo: prima di eseguire il down va ripristinato il codice precedente.
 */
export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "media_visibility_idx"`)
  await db.execute(sql`ALTER TABLE "media" DROP COLUMN IF EXISTS "visibility"`)
  await db.execute(sql`DROP TYPE IF EXISTS "enum_media_visibility"`)
}
