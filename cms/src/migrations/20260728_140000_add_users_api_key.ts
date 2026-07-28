import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Abilita useAPIKey sulla collection `users` (payload.config.ts) — aggiunge i campi
// nativi Payload per l'autenticazione via API key, alternativa alla password per
// integrazioni server-to-server (es. agenti che devono scrivere su Products senza
// mai maneggiare una password di login).
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "users"
    ADD COLUMN IF NOT EXISTS "enable_api_key" boolean,
    ADD COLUMN IF NOT EXISTS "api_key" varchar,
    ADD COLUMN IF NOT EXISTS "api_key_index" varchar
  `)

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS "users_api_key_index_idx"
    ON "users" USING btree ("api_key_index")
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "users_api_key_index_idx"`)
  await db.execute(sql`
    ALTER TABLE "users"
    DROP COLUMN IF EXISTS "api_key_index",
    DROP COLUMN IF EXISTS "api_key",
    DROP COLUMN IF EXISTS "enable_api_key"
  `)
}
