import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { test } from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Orders } from './Orders'
import { AffiliateConversions } from './AffiliateConversions'

/**
 * Questi test parlano con un PostgreSQL vero e isolato (`refund_orders_isolated`):
 * la garanzia che stanno provando e' il serializzarsi delle transizioni cumulative
 * sotto `FOR UPDATE`, che un mock di funzione non puo' dimostrare.
 *
 * L'ordine delle transizioni NON si misura sull'importo: l'importo cumulativo di
 * un charge **scende** quando Stripe passa un rimborso a `failed`/`canceled`, e una
 * guardia monotona sull'importo lascerebbe l'ordine sovra-rimborsato (difetto della
 * card t_6f9c968d). L'ordinamento e' il numero di rimborsi presenti sul charge
 * (`refundCount`): Stripe non cancella i rimborsi, quindi il conteggio cresce quando
 * nasce un rimborso e non torna mai indietro; un calo dell'importo a conteggio
 * invariato e' un rimborso annullato, uno snapshot piu' vecchio ha conteggio minore.
 */

const enabled = process.env.REFUND_TEST_DATABASE_URL === 'isolated-postgres-required'
const dialect = new PgDialect()

const SCHEMA = `
  DROP TABLE IF EXISTS orders;
  DROP TABLE IF EXISTS affiliate_conversions;
  DROP TYPE IF EXISTS enum_orders_refund_status;
  DROP TYPE IF EXISTS enum_orders_payment_status;
  DROP TYPE IF EXISTS enum_affiliate_conversions_payment_status;
  DROP TYPE IF EXISTS enum_affiliate_conversions_refund_status;
  CREATE TYPE enum_orders_refund_status AS ENUM ('none', 'partial', 'full');
  CREATE TYPE enum_orders_payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');
  CREATE TYPE enum_affiliate_conversions_payment_status AS ENUM ('paid', 'refunded', 'partially_refunded', 'cancelled');
  CREATE TYPE enum_affiliate_conversions_refund_status AS ENUM ('none', 'partial', 'full');
  CREATE TABLE orders (
    id serial PRIMARY KEY,
    stripe_payment_intent_id text UNIQUE NOT NULL,
    order_number text,
    amount_refunded_cents bigint,
    refund_status enum_orders_refund_status,
    payment_status enum_orders_payment_status NOT NULL,
    last_refunded_at timestamptz,
    refund_count bigint,
    affiliate_commission_cents bigint,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE affiliate_conversions (
    id serial PRIMARY KEY,
    stripe_payment_intent_id text UNIQUE NOT NULL,
    order_number text NOT NULL,
    payment_status enum_affiliate_conversions_payment_status NOT NULL,
    refund_status enum_affiliate_conversions_refund_status NOT NULL,
    amount_refunded_cents bigint NOT NULL,
    commission_amount_cents bigint NOT NULL,
    commission_pre_refund_cents bigint,
    refund_count bigint,
    refunded_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
  );`

/** Adattatore Drizzle minimo: transazione vera su un client dedicato del pool. */
function drizzleOverPool(pool: Pool) {
  return {
    drizzle: {
      transaction: async <T>(run: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> => {
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const result = await run({
            execute: async (query) => {
              const compiled = dialect.sqlToQuery(query as never)
              const response = await client.query(compiled.sql, compiled.params)
              return { rows: response.rows }
            },
          })
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        } finally {
          client.release()
        }
      },
    },
  }
}

function orderHandler(pool: Pool) {
  process.env.STOREFRONT_API_SECRET = 'isolated-postgres-refund-test-secret'
  const endpoints = Array.isArray(Orders.endpoints) ? Orders.endpoints : []
  const entry = endpoints.find((item) => item.path === '/apply-refund-transition')
  assert.ok(entry?.handler)
  const handler = entry.handler as unknown as (req: never) => Promise<Response>
  const db = drizzleOverPool(pool)
  return (body: Record<string, unknown>) => handler({
    headers: new Headers({ 'x-storefront-secret': process.env.STOREFRONT_API_SECRET! }),
    user: null,
    json: async () => body,
    payload: { db },
  } as never)
}

function affiliateHandler(pool: Pool) {
  process.env.STOREFRONT_API_SECRET = 'isolated-postgres-refund-test-secret'
  const endpoints = Array.isArray(AffiliateConversions.endpoints) ? AffiliateConversions.endpoints : []
  const entry = endpoints.find((item) => item.path === '/apply-refund-transition')
  assert.ok(entry?.handler)
  const handler = entry.handler as unknown as (req: never) => Promise<Response>
  const db = drizzleOverPool(pool)
  return (body: Record<string, unknown>) => handler({
    headers: new Headers({ 'x-storefront-secret': process.env.STOREFRONT_API_SECRET! }),
    user: null,
    json: async () => body,
    payload: { db },
  } as never)
}

async function isolatedPool(pool: Pool) {
  const identity = await pool.query('SELECT current_database() AS database')
  assert.equal(identity.rows[0]?.database, 'refund_orders_isolated', 'rifiuta qualunque DB non dedicato al test')
  await pool.query(SCHEMA)
}

test('Orders refund handler serializes concurrent cumulative transitions in isolated PostgreSQL', { skip: !enabled }, async () => {
  const pool = new Pool()
  try {
    await isolatedPool(pool)
    await pool.query(`
      INSERT INTO orders (stripe_payment_intent_id, amount_refunded_cents, refund_status, payment_status, last_refunded_at, refund_count)
      VALUES ('pi_pg_concurrent', NULL, NULL, 'paid', NULL, NULL),
             ('pi_pg_equal_retry', 2500, 'partial', 'paid', NULL, 1)
    `)

    const apply = orderHandler(pool)
    const concurrent = await Promise.all([
      apply({ stripePaymentIntentId: 'pi_pg_concurrent', amountRefundedCents: 2500, chargeAmountCents: 10000, refundCount: 1, lastRefundedAt: '2026-11-20T09:00:00.000Z' }),
      apply({ stripePaymentIntentId: 'pi_pg_concurrent', amountRefundedCents: 7500, chargeAmountCents: 10000, refundCount: 2, lastRefundedAt: '2026-11-20T10:00:00.000Z' }),
      apply({ stripePaymentIntentId: 'pi_pg_concurrent', amountRefundedCents: 5000, chargeAmountCents: 10000, refundCount: 2, lastRefundedAt: '2026-11-20T09:30:00.000Z' }),
      apply({ stripePaymentIntentId: 'pi_pg_concurrent', amountRefundedCents: 10000, chargeAmountCents: 10000, refundCount: 3 }),
      apply({ stripePaymentIntentId: 'pi_pg_concurrent', amountRefundedCents: 7500, chargeAmountCents: 10000, refundCount: 2, lastRefundedAt: '2026-11-20T10:00:00.000Z' }),
    ])
    const concurrentResults = await Promise.all(concurrent.map((response) => response.json())) as Array<{ status?: string }>
    assert.ok(concurrentResults.every((result) => result.status === 'updated' || result.status === 'stale'))
    assert.equal(concurrentResults[3]?.status, 'updated', 'il massimo cumulativo deve essere applicato')
    const final = await pool.query(`
      SELECT amount_refunded_cents, refund_status, payment_status, last_refunded_at, refund_count
      FROM orders WHERE stripe_payment_intent_id = 'pi_pg_concurrent'
    `)
    assert.equal(Number(final.rows[0]?.amount_refunded_cents), 10000)
    assert.equal(final.rows[0]?.refund_status, 'full')
    assert.equal(final.rows[0]?.payment_status, 'refunded')
    assert.equal(final.rows[0]?.last_refunded_at, null, 'il cumulativo più recente senza data non eredita una data più vecchia')
    assert.equal(Number(final.rows[0]?.refund_count), 3)

    const equalRetry = await apply({ stripePaymentIntentId: 'pi_pg_equal_retry', amountRefundedCents: 2500, chargeAmountCents: 10000, refundCount: 1, lastRefundedAt: '2026-11-20T11:00:00.000Z' })
    assert.deepEqual(await equalRetry.json(), { status: 'updated' })
    const replay = await apply({ stripePaymentIntentId: 'pi_pg_equal_retry', amountRefundedCents: 2500, chargeAmountCents: 10000, refundCount: 1 })
    assert.deepEqual(await replay.json(), { status: 'stale' })
    const retryState = await pool.query(`
      SELECT amount_refunded_cents, refund_status, payment_status, last_refunded_at
      FROM orders WHERE stripe_payment_intent_id = 'pi_pg_equal_retry'
    `)
    assert.equal(Number(retryState.rows[0]?.amount_refunded_cents), 2500)
    assert.equal(retryState.rows[0]?.refund_status, 'partial')
    assert.equal(retryState.rows[0]?.payment_status, 'paid')
    assert.equal(new Date(retryState.rows[0]?.last_refunded_at).toISOString(), '2026-11-20T11:00:00.000Z')
  } finally {
    await pool.end()
  }
})

test('un rimborso annullato abbassa il cumulativo, uno snapshot vecchio no', { skip: !enabled }, async () => {
  const pool = new Pool()
  try {
    await isolatedPool(pool)
    await pool.query(`
      INSERT INTO orders (stripe_payment_intent_id, amount_refunded_cents, refund_status, payment_status, last_refunded_at, refund_count)
      VALUES ('pi_pg_cancelled', 3000, 'partial', 'paid', '2026-11-20T10:00:00.000Z', 2),
             ('pi_pg_full_cancelled', 10000, 'full', 'refunded', '2026-11-20T10:00:00.000Z', 1),
             ('pi_pg_never_refunded', NULL, NULL, 'paid', NULL, NULL)
    `)
    const apply = orderHandler(pool)
    const row = async (paymentIntent: string) => (await pool.query(
      `SELECT amount_refunded_cents, refund_status, payment_status, last_refunded_at, refund_count
       FROM orders WHERE stripe_payment_intent_id = $1`,
      [paymentIntent],
    )).rows[0] as Record<string, unknown>

    // RIMBORSO ANNULLATO: Stripe passa un rimborso a `failed`, il cumulativo scende
    // da 3000 a 1000 e il conteggio dei rimborsi resta 2 (il rimborso fallito esiste
    // ancora). Il calo e' legittimo e va applicato.
    const cancelledRefund = await apply({
      stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 1000, chargeAmountCents: 10000,
      refundCount: 2, lastRefundedAt: '2026-11-20T11:00:00.000Z',
    })
    assert.deepEqual(await cancelledRefund.json(), { status: 'updated' }, 'un rimborso annullato deve abbassare il cumulativo')
    const afterCancellation = await row('pi_pg_cancelled')
    assert.equal(Number(afterCancellation.amount_refunded_cents), 1000)
    assert.equal(afterCancellation.refund_status, 'partial')
    assert.equal(afterCancellation.payment_status, 'paid')
    assert.equal(new Date(String(afterCancellation.last_refunded_at)).toISOString(), '2026-11-20T11:00:00.000Z')

    // SNAPSHOT VECCHIO con lo stesso conteggio: importo piu' alto consegnato dopo.
    const staleSnapshot = await apply({
      stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 3000, chargeAmountCents: 10000, refundCount: 2,
    })
    assert.deepEqual(await staleSnapshot.json(), { status: 'stale' }, 'uno snapshot piu vecchio non deve rialzare il cumulativo')
    assert.equal(Number((await row('pi_pg_cancelled')).amount_refunded_cents), 1000)

    // SNAPSHOT VECCHIO con meno rimborsi: precedente anche a parita' di importo.
    const olderSnapshot = await apply({
      stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 1000, chargeAmountCents: 10000, refundCount: 1,
    })
    assert.deepEqual(await olderSnapshot.json(), { status: 'stale' }, 'un conteggio minore e uno stato precedente')

    // NUOVO RIMBORSO: il conteggio cresce, quindi lo stato e' piu' recente anche se
    // il cumulativo scende (un rimborso annullato e uno nuovo nello stesso intervallo).
    const newerRefund = await apply({
      stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 2000, chargeAmountCents: 10000, refundCount: 3,
    })
    assert.deepEqual(await newerRefund.json(), { status: 'updated' })

    // DUE CONSEGNE CONCORRENTI DI ETA' DIVERSA: vince quella con piu' rimborsi,
    // qualunque sia l'ordine di arrivo.
    const [olderDelivery, newerDelivery] = await Promise.all([
      apply({ stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 1000, chargeAmountCents: 10000, refundCount: 2 }),
      apply({ stripePaymentIntentId: 'pi_pg_cancelled', amountRefundedCents: 5000, chargeAmountCents: 10000, refundCount: 4 }),
    ])
    const olderResult = await olderDelivery.json() as { status?: string }
    const newerResult = await newerDelivery.json() as { status?: string }
    assert.equal(newerResult.status, 'updated')
    assert.ok(['updated', 'stale'].includes(String(olderResult.status)))
    assert.equal(Number((await row('pi_pg_cancelled')).amount_refunded_cents), 5000)

    // TUTTI I RIMBORSI ANNULLATI: il cumulativo torna a zero e l'ordine torna pagato.
    const allCancelled = await apply({
      stripePaymentIntentId: 'pi_pg_full_cancelled', amountRefundedCents: 0, chargeAmountCents: 10000,
      refundCount: 1, lastRefundedAt: '2026-11-20T12:00:00.000Z',
    })
    assert.deepEqual(await allCancelled.json(), { status: 'updated' }, 'un full annullato deve riportare l ordine a pagato')
    const afterFullCancellation = await row('pi_pg_full_cancelled')
    assert.equal(Number(afterFullCancellation.amount_refunded_cents), 0)
    assert.equal(afterFullCancellation.refund_status, 'none')
    assert.equal(afterFullCancellation.payment_status, 'paid')

    // Un rimborso a zero su un ordine che non ne ha mai avuti non e' uno stato nostro.
    const zeroOnCleanOrder = await apply({
      stripePaymentIntentId: 'pi_pg_never_refunded', amountRefundedCents: 0, chargeAmountCents: 10000, refundCount: 1,
    })
    assert.deepEqual(await zeroOnCleanOrder.json(), { status: 'stale' })
    assert.equal((await row('pi_pg_never_refunded')).amount_refunded_cents, null)
  } finally {
    await pool.end()
  }
})

/**
 * RAMO AFFILIATE. Con il marker affiliate lo stesso evento di rimborso annullato
 * produceva `500 Malformed affiliate conversion state` e la rotta rispondeva 503
 * per sempre: il ledger non sapeva tornare indietro da `full`. Qui si prova, su
 * SQL vero, che il ledger riapre il rimborso, ripristina la commissione (quella
 * registrata prima dell'azzeramento, non una formula inventata) e la rimette
 * anche sull'ordine.
 */
test('il ledger affiliate riapre un rimborso annullato e ripristina la commissione', { skip: !enabled }, async () => {
  const pool = new Pool()
  try {
    await isolatedPool(pool)
    await pool.query(`
      INSERT INTO orders (stripe_payment_intent_id, order_number, payment_status, affiliate_commission_cents)
      VALUES ('pi_pg_affiliate', 'ORD-AFF-1', 'paid', 0)
    `)
    await pool.query(`
      INSERT INTO affiliate_conversions
        (stripe_payment_intent_id, order_number, payment_status, refund_status, amount_refunded_cents,
         commission_amount_cents, commission_pre_refund_cents, refund_count)
      VALUES ('pi_pg_affiliate', 'ORD-AFF-1', 'refunded', 'full', 10000, 0, 450, 1)
    `)
    const apply = affiliateHandler(pool)
    const conversion = async () => (await pool.query(
      `SELECT payment_status, refund_status, amount_refunded_cents, commission_amount_cents
       FROM affiliate_conversions WHERE stripe_payment_intent_id = 'pi_pg_affiliate'`,
    )).rows[0] as Record<string, unknown>
    const orderCommission = async () => Number((await pool.query(
      `SELECT affiliate_commission_cents FROM orders WHERE stripe_payment_intent_id = 'pi_pg_affiliate'`,
    )).rows[0]?.affiliate_commission_cents)

    // Rimborso annullato: full -> partial. Non e' un errore contabile, e' uno stato
    // precedente che torna valido: la commissione torna quella di prima.
    const reopened = await apply({
      stripePaymentIntentId: 'pi_pg_affiliate', amountRefundedCents: 2500, refundStatus: 'partial', refundCount: 1,
    })
    assert.equal(reopened.status, 200, 'un rimborso annullato non deve produrre 500')
    assert.deepEqual(await reopened.json(), { status: 'updated' })
    const afterReopen = await conversion()
    assert.equal(afterReopen.payment_status, 'partially_refunded')
    assert.equal(afterReopen.refund_status, 'partial')
    assert.equal(Number(afterReopen.amount_refunded_cents), 2500)
    assert.equal(Number(afterReopen.commission_amount_cents), 450, 'la commissione azzerata dal full va ripristinata')
    assert.equal(await orderCommission(), 450, 'anche l ordine deve tornare a maturare la commissione')

    // Snapshot vecchio (conteggio minore): non riapre nulla.
    const staleSnapshot = await apply({
      stripePaymentIntentId: 'pi_pg_affiliate', amountRefundedCents: 10000, refundStatus: 'full', refundCount: 0,
    })
    assert.equal(staleSnapshot.status, 200)
    assert.deepEqual(await staleSnapshot.json(), { status: 'stale' })
    assert.equal(Number((await conversion()).amount_refunded_cents), 2500)

    // Nuovo full: la commissione si azzera di nuovo e l'importo originale resta registrato.
    const refundedAgain = await apply({
      stripePaymentIntentId: 'pi_pg_affiliate', amountRefundedCents: 10000, refundStatus: 'full', refundCount: 2,
    })
    assert.deepEqual(await refundedAgain.json(), { status: 'updated' })
    const afterSecondFull = await conversion()
    assert.equal(afterSecondFull.payment_status, 'refunded')
    assert.equal(Number(afterSecondFull.commission_amount_cents), 0)
    assert.equal(await orderCommission(), 0)

    // Tutti i rimborsi annullati: l'ordine torna pagato e la commissione matura.
    const allCancelled = await apply({
      stripePaymentIntentId: 'pi_pg_affiliate', amountRefundedCents: 0, refundStatus: 'none', refundCount: 2,
    })
    assert.deepEqual(await allCancelled.json(), { status: 'updated' })
    const afterAllCancelled = await conversion()
    assert.equal(afterAllCancelled.payment_status, 'paid')
    assert.equal(afterAllCancelled.refund_status, 'none')
    assert.equal(Number(afterAllCancelled.amount_refunded_cents), 0)
    assert.equal(Number(afterAllCancelled.commission_amount_cents), 450)
    assert.equal(await orderCommission(), 450)
  } finally {
    await pool.end()
  }
})
