import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Chiave di risoluzione del pagamento: `stripe_session_id` sull'ordine.
 *
 * PERCHE'. Il webhook dello storefront riconosceva un pagamento solo dal
 * metadata `order_ref`; quando mancava, inventava `FOOLISH-${session.id}` come
 * numero d'ordine (~74 caratteri, deep link Telegram rotto, riferimento che il
 * cliente non aveva mai visto). Ora l'id di sessione e' una colonna dell'ordine:
 * il webhook, i retry di Stripe e il cron di riconciliazione convergono sulla
 * stessa riga, e l'id di sessione non diventa mai un numero d'ordine.
 *
 * ADDITIVA E NULLA-SAFE. Nessun default, nessun NOT NULL, nessuna scrittura sui
 * documenti esistenti: gli ordini del flusso vecchio restano senza il dato e
 * vengono ritrovati dal loro numero (`FOOLISH-<session.id>`). In PostgreSQL i
 * NULL non collidono su un indice unico, quindi `ADD COLUMN` con NULL + indice
 * unico non puo' fallire per duplicati.
 *
 * NESSUN BACKFILL. Il numero legacy contiene l'id di sessione, ma ricavarlo per
 * congettura e scriverlo su una colonna unica significherebbe dichiarare un dato
 * che nessuno ha verificato: la ricerca legacy fa lo stesso lavoro in lettura.
 *
 * ROLLBACK. `down()` toglie indice e colonna. La colonna e' informazione
 * derivata (l'id di sessione vive anche nei metadata Stripe), e il numero
 * d'ordine non viene toccato: nessun ordine diventa irraggiungibile.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "stripe_session_id" varchar
  `)

  // Indice unico: e' anche l'indice di ricerca usato dal webhook (`index: true`
  // sul campo). Non si crea un secondo indice non-unico sulla stessa colonna.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS "orders_stripe_session_id_idx"
      ON "orders" USING btree ("stripe_session_id")
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`DROP INDEX IF EXISTS "orders_stripe_session_id_idx"`)
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "stripe_session_id"
  `)
}
