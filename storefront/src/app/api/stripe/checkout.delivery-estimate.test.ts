import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import test from 'node:test'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'
import { parseDeliveryPromiseMetadataValue } from '@/lib/delivery-promise'

// Fence every HTTPS path before the route is dynamically loaded. CMS access in
// this test is only the ephemeral HTTP localhost server; Stripe is stubbed.
const require = createRequire(import.meta.url)
const https = require('node:https') as typeof import('node:https')
const originalHttpsRequest = https.request
const originalHttpsGet = https.get
let blockedHttpsAttempts = 0
const denyHttps = (() => {
  blockedHttpsAttempts += 1
  throw new Error('External HTTPS is disabled in checkout route tests')
}) as typeof https.request
https.request = denyHttps
https.get = denyHttps as typeof https.get
const originalFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    blockedHttpsAttempts += 1
    return Promise.reject(new Error('Only HTTP localhost is allowed in checkout route tests'))
  }
  return originalFetch(input, init)
}) as typeof fetch

/**
 * Il gate della stima: la data che il cliente ha VISTO e' l'unica che puo'
 * entrare nella sessione di pagamento. Se il server ne calcola un'altra — o
 * nessuna — il checkout risponde 409 e non apre Stripe. Un carrello senza data
 * mostrabile non blocca il pagamento: non promette niente e non registra niente.
 *
 * Qui si guarda la sessione Stripe: la promessa che il webhook portera'
 * sull'ordine nasce da questi metadata, quindi si verifica che ci sia e che sia
 * coerente con la data mostrata (e che non ne inventi una quando non c'e').
 */
test('real checkout route requires exact estimate confirmation before Stripe', async () => {
  const stripeSessions: Array<Record<string, unknown>> = []
  let cmsProductionDays: number | null = 5
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/api/orders' && req.method === 'GET') {
      res.end(JSON.stringify({ docs: [] }))
      return
    }
    if (url.pathname === '/api/products/1') {
      res.end(JSON.stringify({
        id: 1,
        name: 'Synthetic made-to-order item',
        active: true,
        madeToOrder: true,
        productionDays: cmsProductionDays,
        variants: [{ sku: 'SYNTH-MTO', label: 'Synthetic', price: 10, stockStatus: 'available' }],
      }))
      return
    }
    res.statusCode = 404
    res.end(JSON.stringify({ docs: [] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  const previousEnv = {
    payloadUrl: process.env.PAYLOAD_PUBLIC_URL,
    storefrontSecret: process.env.STOREFRONT_API_SECRET,
    stripeSecret: process.env.STRIPE_SECRET_KEY,
  }
  process.env.PAYLOAD_PUBLIC_URL = `http://127.0.0.1:${port}`
  process.env.STOREFRONT_API_SECRET = 'synthetic-test-secret'
  process.env.STRIPE_SECRET_KEY = 'sk_test_synthetic_only'

  const stripe = new Stripe('sk_test_synthetic_only')
  type SessionCreate = (params: Stripe.Checkout.SessionCreateParams) => Promise<unknown>
  const sessionsResource = Object.getPrototypeOf(stripe.checkout.sessions) as { create: SessionCreate }
  const originalCreate = sessionsResource.create
  sessionsResource.create = async (params: Stripe.Checkout.SessionCreateParams) => {
    const session = {
      id: 'cs_test_delivery_estimate', object: 'checkout.session', livemode: true,
      mode: 'payment', payment_status: 'paid', payment_intent: 'pi_test_delivery_estimate',
      amount_total: 2765, currency: 'eur', customer_email: 'synthetic@example.invalid',
      customer_details: { name: 'Synthetic Customer', email: 'synthetic@example.invalid' }, metadata: params.metadata,
    }
    stripeSessions.push(session)
    return { url: 'https://checkout.stripe.test/session', ...session }
  }
  const requestFor = (date?: string | null) => new NextRequest('http://shop.test/api/stripe/checkout', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      items: [{ productId: '1', sku: 'SYNTH-MTO', quantity: 1 }],
      ...(date === undefined ? {} : { deliveryEstimateDate: date }),
      customer: { email: 'synthetic@example.invalid', name: 'Synthetic Customer', firstName: 'Synthetic', lastName: 'Customer', country: 'IT', address: 'Via Sintetica 1', city: 'Torino', postalCode: '10100', phone: '+390****0000' },
    }),
  })

  try {
    const { POST } = await import('./checkout/route')
    const estimateRoute = await import('./delivery-estimate/route')
    const estimateResponse = await estimateRoute.POST(new NextRequest('http://shop.test/api/stripe/delivery-estimate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ country: 'IT', items: [{ productId: '1', sku: 'SYNTH-MTO', quantity: 1 }] }),
    }))
    const estimate = await estimateResponse.json() as { deliveryEstimateDate: string; productionDays: number }
    assert.match(estimate.deliveryEstimateDate, /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(estimate.productionDays, 5)
    // An absent client field means no date was ever shown: the sale proceeds
    // without a promise and nothing is written in the session metadata.
    cmsProductionDays = 3_651
    const unavailableWithoutDate = await POST(requestFor())
    assert.equal(unavailableWithoutDate.status, 200)
    assert.equal(stripeSessions.length, 1)
    assert.equal('delivery_estimate_date' in (stripeSessions[0]!.metadata as Record<string, unknown>), false)
    // Nessuna data vista = nessuna promessa, e lo snapshot lo dichiara invece di
    // tacere o di inventare una data.
    const hiddenPromise = parseDeliveryPromiseMetadataValue(
      (stripeSessions[0]!.metadata as Record<string, string>).delivery_promise,
    )
    assert.equal(hiddenPromise?.promiseShown, false)
    assert.equal(hiddenPromise?.reason, 'not_shown')
    assert.equal(hiddenPromise?.estimatedDeliveryDate, null)
    stripeSessions.length = 0

    // Regression 1: a date was shown, then CMS makes the computation fail.
    // The stale promise must not be silently dropped while creating Stripe.
    const noLongerAvailable = await POST(requestFor(estimate.deliveryEstimateDate))
    const unavailablePayload = await noLongerAvailable.json() as {
      error?: string; deliveryEstimateDate?: string | null; productionDays?: number | null
    }
    assert.equal(noLongerAvailable.status, 409)
    assert.equal(unavailablePayload.error, 'delivery_estimate_unavailable')
    assert.equal(unavailablePayload.deliveryEstimateDate, null)
    assert.equal(unavailablePayload.productionDays, null)
    assert.equal(stripeSessions.length, 0)

    const invalidDate = await POST(new NextRequest('http://shop.test/api/stripe/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        items: [{ productId: '1', sku: 'SYNTH-MTO', quantity: 1 }],
        deliveryEstimateDate: 123,
        customer: { email: 'synthetic@example.invalid', name: 'Synthetic Customer', firstName: 'Synthetic', lastName: 'Customer', country: 'IT', address: 'Via Sintetica 1', city: 'Torino', postalCode: '10100', phone: '+390****0000' },
      }),
    }))
    assert.equal(invalidDate.status, 400)
    assert.equal(stripeSessions.length, 0)

    // Regression 2: CMS can produce a date again, but this client never saw
    // one (field absent). A tab opened before the promise existed must still
    // be able to pay: no date is written, nothing is promised.
    cmsProductionDays = 5
    const absentWithServerDate = await POST(requestFor())
    assert.equal(absentWithServerDate.status, 200)
    assert.equal(stripeSessions.length, 1)
    assert.equal('delivery_estimate_date' in (stripeSessions[0]!.metadata as Record<string, unknown>), false)
    stripeSessions.length = 0

    // Il cliente ha visto «nessuna data» (stima non calcolabile) e prosegue con
    // il campo esplicito a null: lo snapshot registra il motivo e la zona, senza
    // date. E' diverso dal campo assente: li' non c'e' stato nessun calcolo.
    cmsProductionDays = 3_651
    const explicitNoDate = await POST(requestFor(null))
    assert.equal(explicitNoDate.status, 200)
    assert.equal(stripeSessions.length, 1)
    const unavailablePromise = parseDeliveryPromiseMetadataValue(
      (stripeSessions[0]!.metadata as Record<string, string>).delivery_promise,
    )
    assert.equal(unavailablePromise?.promiseShown, false)
    assert.equal(unavailablePromise?.reason, 'estimate_unavailable')
    assert.equal(unavailablePromise?.zone, 'IT_EU')
    assert.equal(unavailablePromise?.estimatedDeliveryDate, null)
    stripeSessions.length = 0
    cmsProductionDays = 5

    // Regression 3: a date the client DID show, but a different one from what
    // the server computes now, still requires reconfirmation.
    const stale = estimate.deliveryEstimateDate === '2026-01-05' ? '2026-01-06' : '2026-01-05'
    const staleDate = await POST(requestFor(stale))
    const stalePayload = await staleDate.json() as {
      error?: string; deliveryEstimateDate?: string | null; productionDays?: number | null
    }
    assert.equal(staleDate.status, 409)
    assert.equal(stalePayload.error, 'delivery_estimate_changed')
    assert.equal(stalePayload.deliveryEstimateDate, estimate.deliveryEstimateDate)
    assert.equal(stalePayload.productionDays, 5)
    assert.equal(stripeSessions.length, 0)

    const accepted = await POST(requestFor(estimate.deliveryEstimateDate))
    assert.equal(accepted.status, 200)
    assert.equal(stripeSessions.length, 1)
    const metadata = stripeSessions[0]!.metadata as Record<string, string>
    assert.equal(metadata.delivery_estimate_date, estimate.deliveryEstimateDate)
    const promise = parseDeliveryPromiseMetadataValue(metadata.delivery_promise)
    assert.notEqual(promise, null, 'la sessione porta lo snapshot della promessa')
    assert.equal(promise?.promiseShown, true)
    assert.equal(promise?.reason, 'ok')
    assert.equal(promise?.zone, 'IT_EU')
    assert.equal(promise?.estimatedDeliveryDate, estimate.deliveryEstimateDate)
    assert.match(promise?.departureDate ?? '', /^\d{4}-\d{2}-\d{2}$/)
    assert.equal(promise?.productionDays, 5)
    assert.equal(promise?.marginDays, 2)
    assert.equal(promise?.fallback, false)
    assert.match(promise?.calculatedAt ?? '', /Z$/)
    assert.equal(blockedHttpsAttempts, 0, 'no external HTTPS attempt was made')
  } finally {
    sessionsResource.create = originalCreate
    if (previousEnv.payloadUrl === undefined) delete process.env.PAYLOAD_PUBLIC_URL
    else process.env.PAYLOAD_PUBLIC_URL = previousEnv.payloadUrl
    if (previousEnv.storefrontSecret === undefined) delete process.env.STOREFRONT_API_SECRET
    else process.env.STOREFRONT_API_SECRET = previousEnv.storefrontSecret
    if (previousEnv.stripeSecret === undefined) delete process.env.STRIPE_SECRET_KEY
    else process.env.STRIPE_SECRET_KEY = previousEnv.stripeSecret
    await new Promise<void>((resolve) => server.close(() => resolve()))
    https.request = originalHttpsRequest
    https.get = originalHttpsGet
    globalThis.fetch = originalFetch
  }
})
