import assert from 'node:assert/strict'
import { Pool } from 'pg'
import { test } from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { Orders } from './Orders'

const enabled = process.env.REFUND_TEST_DATABASE_URL === 'isolated-postgres-required'
const dialect = new PgDialect()

test('Orders refund handler serializes concurrent cumulative transitions in isolated PostgreSQL', { skip: !enabled }, async () => {
  const pool = new Pool()
  const schema = `
    DROP TABLE IF EXISTS orders;
    DROP TYPE IF EXISTS enum_orders_refund_status;
    DROP TYPE IF EXISTS enum_orders_payment_status;
    CREATE TYPE enum_orders_refund_status AS ENUM ('none', 'partial', 'full');
    CREATE TYPE enum_orders_payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');
    CREATE TABLE orders (
      id serial PRIMARY KEY,
      stripe_payment_intent_id text UNIQUE NOT NULL,
      amount_refunded_cents bigint,
      refund_status enum_orders_refund_status,
      payment_status enum_orders_payment_status NOT NULL,
      last_refunded_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now()
    );`
  try {
    const identity = await pool.query('SELECT current_database() AS database')
    assert.equal(identity.rows[0]?.database, 'refund_orders_isolated', 'rifiuta qualunque DB non dedicato al test')
    await pool.query(schema)
    await pool.query(`
      INSERT INTO orders (stripe_payment_intent_id, amount_refunded_cents, refund_status, payment_status, last_refunded_at)
      VALUES ('pi_pg_concurrent', NULL, NULL, 'paid', NULL),
             ('pi_pg_equal_retry', 2500, 'partial', 'paid', NULL)
    `)

    const db = {
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
    process.env.STOREFRONT_API_SECRET = 'isolated-postgres-refund-test-secret'
    const endpoints = Array.isArray(Orders.endpoints) ? Orders.endpoints : []
    const entry = endpoints.find((item) => item.path === '/apply-refund-transition')
    assert.ok(entry?.handler)
    const handler = entry.handler as unknown as (req: never) => Promise<Response>
    const apply = (paymentIntentId: string, amount: number, lastRefundedAt?: string) => handler({
      headers: new Headers({ 'x-storefront-secret': process.env.STOREFRONT_API_SECRET! }),
      user: null,
      json: async () => ({
        stripePaymentIntentId: paymentIntentId,
        amountRefundedCents: amount,
        chargeAmountCents: 10000,
        ...(lastRefundedAt ? { lastRefundedAt } : {}),
      }),
      payload: { db },
    } as never)

    const concurrent = await Promise.all([
      apply('pi_pg_concurrent', 2500, '2026-11-20T09:00:00.000Z'),
      apply('pi_pg_concurrent', 7500, '2026-11-20T10:00:00.000Z'),
      apply('pi_pg_concurrent', 5000, '2026-11-20T09:30:00.000Z'),
      apply('pi_pg_concurrent', 10000),
      apply('pi_pg_concurrent', 7500, '2026-11-20T10:00:00.000Z'),
    ])
    const concurrentResults = await Promise.all(concurrent.map((response) => response.json())) as Array<{ status?: string }>
    assert.ok(concurrentResults.every((result) => result.status === 'updated' || result.status === 'stale'))
    assert.equal(concurrentResults[3]?.status, 'updated', 'il massimo cumulativo deve essere applicato')
    const final = await pool.query(`
      SELECT amount_refunded_cents, refund_status, payment_status, last_refunded_at
      FROM orders WHERE stripe_payment_intent_id = 'pi_pg_concurrent'
    `)
    assert.equal(Number(final.rows[0]?.amount_refunded_cents), 10000)
    assert.equal(final.rows[0]?.refund_status, 'full')
    assert.equal(final.rows[0]?.payment_status, 'refunded')
    assert.equal(final.rows[0]?.last_refunded_at, null, 'il cumulativo più recente senza data non eredita una data più vecchia')

    const equalRetry = await apply('pi_pg_equal_retry', 2500, '2026-11-20T11:00:00.000Z')
    assert.deepEqual(await equalRetry.json(), { status: 'updated' })
    const replay = await apply('pi_pg_equal_retry', 2500)
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
