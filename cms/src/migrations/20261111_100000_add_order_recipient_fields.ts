import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Nome, cognome e provincia dell'indirizzo di spedizione, in colonne proprie.
 *
 * PERCHE'. Il checkout italiano raccoglie nome e cognome separati (li vogliono
 * etichetta e corriere) e la sigla di provincia, che il CAP non identifica in
 * modo univoco. Finora queste informazioni vivevano solo dentro il campo
 * `name` e in nessun posto per la provincia: chi prepara la spedizione doveva
 * ricavarli a mano.
 *
 * ADDITIVA E NULLA-SAFE. Tre `varchar` senza default e senza NOT NULL: gli
 * ordini esistenti restano validi con le colonne a NULL, e il codice che li
 * legge deriva nome e cognome da `name` in lettura. Nessun backfill e nessuna
 * scrittura sui documenti storici: una sigla ricavata dal CAP sarebbe un dato
 * inventato, e sbagliare la provincia significa sbagliare la zona di spedizione.
 *
 * ROLLBACK. Non distruttivo, per scelta: `down()` non toglie le colonne.
 * - Nome e cognome sono derivabili da `name`, ma la provincia NO: non esiste in
 *   nessun altro campo, quindi un `DROP COLUMN` cancellerebbe l'unica copia di
 *   un dato che il cliente ha scritto.
 * - Con `push: false` il verso del rollback e' il revert del codice: Payload
 *   legge solo i campi dichiarati nella collection, quindi le colonne restano
 *   innocue per il codice vecchio.
 * - La migrazione e' idempotente (`IF NOT EXISTS`), quindi dopo un rollback un
 *   nuovo `up()` non fallisce.
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "shipping_address_first_name" varchar,
      ADD COLUMN IF NOT EXISTS "shipping_address_last_name" varchar,
      ADD COLUMN IF NOT EXISTS "shipping_address_province" varchar
  `)
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Intenzionalmente nessun DROP COLUMN: vedi l'intestazione. Il rollback e' il
  // revert del codice; le colonne restano e non perdono dati.
}
