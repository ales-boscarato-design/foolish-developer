import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { PgDialect } from 'drizzle-orm/pg-core'
import { AffiliateConversions } from './AffiliateConversions'
import { Orders } from './Orders'

const dialect = new PgDialect()
const endpoint = (collection: typeof Orders, path: string) => {
  const endpoints = Array.isArray(collection.endpoints) ? collection.endpoints : []
  const entry = endpoints.find((item) => item.path === path)
  assert.ok(entry?.handler)
  return entry.handler as unknown as (req: never) => Promise<Response>
}

function request(headers: Headers, db: unknown, body: unknown) {
  return {
    headers,
    user: null,
    json: async () => body,
    payload: { db },
  } as never
}

function dbWithExecute(execute: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
  return {
    drizzle: {
      transaction: async (run: (tx: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => unknown) => run({
        execute: async (query) => {
          const compiled = dialect.sqlToQuery(query as never)
          return execute(compiled.sql, compiled.params)
        },
      }),
    },
  }
}

function serviceHeaders(secret: string) {
  return new Headers({ 'x-storefront-secret': secret })
}

test('handler Orders scrive paymentStatus paid per il parziale, compatibile con enum SQL registrato', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  let persistedStatus: unknown
  const db = dbWithExecute(async (query, params) => {
    if (query.includes('SELECT')) return { rows: [{ id: 1, amount_refunded_cents: null, refund_status: null, last_refunded_at: null, refund_count: null }] }
    persistedStatus = params.find((value) => value === 'paid' || value === 'partially_refunded')
    return { rows: [{ id: 1 }] }
  })
  const handler = endpoint(Orders, '/apply-refund-transition')
  const response = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), db, {
    stripePaymentIntentId: 'pi_refund_handler_test', amountRefundedCents: 2500, chargeAmountCents: 10000, refundCount: 1,
  }))
  const migration = await readFile(new URL('../migrations/20260824_100000_add_order_payment_fields.ts', import.meta.url), 'utf8')
  assert.match(migration, /enum_orders_payment_status AS ENUM \('pending', 'paid', 'failed', 'refunded', 'cancelled'\)/)
  assert.equal(response.status, 200)
  assert.equal(persistedStatus, 'paid')
})

test('handler Orders rifiuta il segreto B2B per la transizione refund', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  process.env.B2B_API_SECRET = 'refund-test-b2b-secret'
  let transactionCalled = false
  const db = dbWithExecute(async () => { transactionCalled = true; return { rows: [] } })
  const handler = endpoint(Orders, '/apply-refund-transition')
  await assert.rejects(handler(request(serviceHeaders(process.env.B2B_API_SECRET), db, {
    stripePaymentIntentId: 'pi_refund_handler_test', amountRefundedCents: 2500, chargeAmountCents: 10000,
  })))
  assert.equal(transactionCalled, false)
})

test('handler Orders accetta retry cumulativo pari solo per riempire una data prima ignota', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  const statements: string[] = []
  const db = dbWithExecute(async (query) => {
    statements.push(query)
    if (query.includes('SELECT')) return { rows: [{
      id: 1, amount_refunded_cents: 2500, refund_status: 'partial', last_refunded_at: null, refund_count: 1,
    }] }
    return { rows: [{ id: 1 }] }
  })
  const handler = endpoint(Orders, '/apply-refund-transition')
  const response = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), db, {
    stripePaymentIntentId: 'pi_refund_handler_test', amountRefundedCents: 2500, chargeAmountCents: 10000,
    refundCount: 1,
    lastRefundedAt: '2026-11-20T10:00:00.000Z',
  }))
  assert.deepEqual(await response.json(), { status: 'updated' })
  assert.equal(statements.filter((statement) => statement.includes('UPDATE "orders"')).length, 1)
  assert.match(statements[1]!, /"last_refunded_at" IS NULL/)
})

test('handler Orders cancella la data precedente quando cresce il cumulativo senza data dimostrabile', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  let persistedTimestamp: unknown = '2026-11-19T10:00:00.000Z'
  const db = dbWithExecute(async (query, params) => {
    if (query.includes('SELECT')) return { rows: [{
      id: 1, amount_refunded_cents: 2500, refund_status: 'partial', last_refunded_at: persistedTimestamp, refund_count: 1,
    }] }
    const timestampIndex = params.findIndex((value) => value === null)
    if (query.includes('COALESCE')) {
      persistedTimestamp = params[timestampIndex] ?? persistedTimestamp
    } else {
      persistedTimestamp = params[timestampIndex]
    }
    return { rows: [{ id: 1 }] }
  })
  const handler = endpoint(Orders, '/apply-refund-transition')
  const response = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), db, {
    stripePaymentIntentId: 'pi_refund_handler_test', amountRefundedCents: 5000, chargeAmountCents: 10000, refundCount: 2,
  }))
  assert.deepEqual(await response.json(), { status: 'updated' })
  assert.equal(persistedTimestamp, null)
})

test('handler AffiliateConversions ritenta un full già registrato e ripara la commissione ordine; anomalie restano rifiutate', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  const calls: string[] = []
  const db = dbWithExecute(async (query) => {
    calls.push(query)
    if (query.includes('FROM "affiliate_conversions"')) return { rows: [{
      id: 7,
      stripe_payment_intent_id: 'pi_affiliate_refund_test',
      order_number: 'ORD-TEST-7',
      payment_status: 'refunded',
      refund_status: 'full',
      amount_refunded_cents: 10000,
      commission_amount_cents: 0,
      commission_pre_refund_cents: 450,
      refund_count: 1,
    }] }
    if (query.includes('UPDATE "orders"')) return { rows: [{ id: 9 }] }
    return { rows: [] }
  })
  const handler = endpoint(AffiliateConversions, '/apply-refund-transition')
  const response = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), db, {
    stripePaymentIntentId: 'pi_affiliate_refund_test', amountRefundedCents: 10000, refundStatus: 'full', refundCount: 1,
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'updated' })
  assert.ok(calls.some((query) => query.includes('UPDATE "orders"')))

  const partialDb = dbWithExecute(async (query) => {
    if (query.includes('FROM "affiliate_conversions"')) return { rows: [{
      id: 7,
      stripe_payment_intent_id: 'pi_affiliate_refund_test',
      order_number: 'ORD-TEST-7',
      payment_status: 'partially_refunded',
      refund_status: 'partial',
      amount_refunded_cents: 2500,
      commission_amount_cents: 450,
      commission_pre_refund_cents: null,
      refund_count: 1,
    }] }
    return { rows: [{ id: 7 }] }
  })
  const partialResponse = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), partialDb, {
    stripePaymentIntentId: 'pi_affiliate_refund_test', amountRefundedCents: 5000, refundStatus: 'partial', refundCount: 2,
  }))
  assert.equal(partialResponse.status, 200)
  assert.deepEqual(await partialResponse.json(), { status: 'updated' })

  const malformedDb = dbWithExecute(async (query) => query.includes('FROM "affiliate_conversions"')
    ? { rows: [{
        id: 7,
        stripe_payment_intent_id: 'pi_affiliate_refund_test',
        order_number: 'ORD-TEST-7',
        payment_status: 'refunded',
        refund_status: 'full',
        amount_refunded_cents: 10000,
        commission_amount_cents: 450,
        commission_pre_refund_cents: null,
        refund_count: 1,
      }] }
    : { rows: [] })
  await assert.rejects(handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), malformedDb, {
    stripePaymentIntentId: 'pi_affiliate_refund_test', amountRefundedCents: 10000, refundStatus: 'full', refundCount: 1,
  })))

  const missingOrderDb = dbWithExecute(async (query) => query.includes('FROM "affiliate_conversions"')
    ? { rows: [{
        id: 7,
        stripe_payment_intent_id: 'pi_affiliate_refund_test',
        order_number: 'ORD-TEST-7',
        payment_status: 'refunded',
        refund_status: 'full',
        amount_refunded_cents: 10000,
        commission_amount_cents: 0,
        commission_pre_refund_cents: 450,
        refund_count: 1,
      }] }
    : { rows: [] })
  await assert.rejects(handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), missingOrderDb, {
    stripePaymentIntentId: 'pi_affiliate_refund_test', amountRefundedCents: 10000, refundStatus: 'full', refundCount: 1,
  })))
})

test('handler AffiliateConversions non riapre un full annullato da uno snapshot con meno rimborsi', async () => {
  process.env.STOREFRONT_API_SECRET = 'refund-test-storefront-secret'
  const statements: string[] = []
  const db = dbWithExecute(async (query) => {
    statements.push(query)
    if (query.includes('FROM "affiliate_conversions"')) return { rows: [{
      id: 7,
      stripe_payment_intent_id: 'pi_affiliate_refund_test',
      order_number: 'ORD-TEST-7',
      payment_status: 'refunded',
      refund_status: 'full',
      amount_refunded_cents: 10000,
      commission_amount_cents: 0,
      commission_pre_refund_cents: 450,
      refund_count: 3,
    }] }
    return { rows: [{ id: 7 }] }
  })
  const handler = endpoint(AffiliateConversions, '/apply-refund-transition')
  const response = await handler(request(serviceHeaders(process.env.STOREFRONT_API_SECRET), db, {
    stripePaymentIntentId: 'pi_affiliate_refund_test', amountRefundedCents: 2500, refundStatus: 'partial', refundCount: 2,
  }))
  assert.deepEqual(await response.json(), { status: 'stale' })
  assert.equal(
    statements.some((query) => query.trimStart().startsWith('UPDATE')),
    false,
    'uno snapshot precedente non deve toccare ne la conversione ne l ordine',
  )
})
