import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

/**
 * Ordinamento delle transizioni di rimborso e commissione da ripristinare.
 *
 * - `orders.refund_count` / `affiliate_conversions.refund_count`: numero di
 *   rimborsi presenti sul charge Stripe. E' la chiave di ordinamento delle
 *   transizioni: `amount_refunded` SCENDE quando un rimborso diventa
 *   `failed`/`canceled`, quindi da solo non distingue un calo legittimo da uno
 *   snapshot consegnato fuori ordine (card t_6f9c968d).
 * - `affiliate_conversions.commission_pre_refund_cents`: la commissione com'era
 *   prima che un rimborso totale la azzerasse, per poterla ripristinare se quel
 *   rimborso viene annullato.
 *
 * Tutte le colonne sono additive e nullable: nessun backfill presume un valore.
 * Le righe storiche restano NULL e la guardia le tratta come «conteggio non
 * registrato» (accetta solo crescite).
 */
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "refund_count" numeric
  `)
  await db.execute(sql`
    ALTER TABLE "affiliate_conversions"
      ADD COLUMN IF NOT EXISTS "refund_count" numeric,
      ADD COLUMN IF NOT EXISTS "commission_pre_refund_cents" numeric
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "affiliate_conversions"
      DROP COLUMN IF EXISTS "commission_pre_refund_cents",
      DROP COLUMN IF EXISTS "refund_count"
  `)
  await db.execute(sql`
    ALTER TABLE "orders"
      DROP COLUMN IF EXISTS "refund_count"
  `)
}
