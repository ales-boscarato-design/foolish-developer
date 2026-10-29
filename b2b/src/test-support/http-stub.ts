/**
 * Stub HTTP locale per i test delle DUE ROTTE di checkout.
 *
 * Un solo server `node:http` su porta effimera risponde a:
 *  - CMS:      GET/POST /api/products, /api/orders
 *  - VIES:     POST /vies
 *  - Stripe:   POST /stripe/v1/payment_intents (l'SDK usa il fetch client)
 *
 * `installFetchRouting` sostituisce `globalThis.fetch`: le chiamate CMS
 * restano sull'URL locale, quelle VIES e Stripe vengono riscritte sul server
 * locale, e QUALSIASI altro URL fa fallire il test. Nessuna richiesta puo'
 * uscire verso internet.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'

export interface StubState {
  cmsDocs: unknown[]
  cmsProductsStatus: number
  cmsTotalDocs: number | null
  /** Ritardo della risposta /api/products, per provare il timeout. */
  cmsDelayMs: number
  /** Chiude la connessione a meta' JSON, per provare il corpo troncato. */
  cmsTruncateBody: boolean
  viesValid: boolean
  viesStatus: number
  productsRequests: string[]
  ordersLookups: number
  /** Archivio ordini in memoria: e' il "database" che il CMS finge di avere. */
  cmsOrders: Array<Record<string, unknown>>
  /** POST /api/orders andate a buon fine (ordini davvero creati). */
  orderPosts: Array<Record<string, unknown>>
  /** Tentativi di POST, inclusi quelli rifiutati per orderNumber duplicato. */
  orderPostAttempts: number
  ordersCreated: number
  /** PaymentIntent davvero create (una per chiave di idempotenza). */
  stripeIntents: Array<Record<string, string>>
  /** Risposte del provider per le intent create, per confrontare i secret. */
  stripeIntentResponses: Array<Record<string, unknown>>
  /** Tutte le chiavi di idempotenza viste, anche quelle ripetute. */
  stripeIdempotencyKeys: string[]
  /**
   * Una sola richiesta: la intent viene registrata, poi la connessione cade
   * senza risposta. Riproduce il timeout ambiguo dopo che il provider ha
   * gia' accettato la creazione.
   */
  stripeTimeoutAfterRegister: boolean
  viesRequests: number
}

export const stubState: StubState = {
  cmsDocs: [],
  cmsProductsStatus: 200,
  cmsTotalDocs: null,
  cmsDelayMs: 0,
  cmsTruncateBody: false,
  viesValid: true,
  viesStatus: 200,
  productsRequests: [],
  ordersLookups: 0,
  cmsOrders: [],
  orderPosts: [],
  orderPostAttempts: 0,
  ordersCreated: 0,
  stripeIntents: [],
  stripeIntentResponses: [],
  stripeIdempotencyKeys: [],
  stripeTimeoutAfterRegister: false,
  viesRequests: 0,
}

export function resetStub(): void {
  stubState.cmsDocs = []
  stubState.cmsProductsStatus = 200
  stubState.cmsTotalDocs = null
  stubState.cmsDelayMs = 0
  stubState.cmsTruncateBody = false
  stubState.viesValid = true
  stubState.viesStatus = 200
  stubState.productsRequests = []
  stubState.ordersLookups = 0
  stubState.cmsOrders = []
  stubState.orderPosts = []
  stubState.orderPostAttempts = 0
  stubState.ordersCreated = 0
  stubState.stripeIntents = []
  stubState.stripeIntentResponses = []
  stubState.stripeIdempotencyKeys = []
  stubState.stripeTimeoutAfterRegister = false
  stubState.viesRequests = 0
  stripeIntentsByIdempotencyKey.clear()
}

/** Marca un ordine come pagato, per esercitare il ramo `ordine_gia_pagato`. */
export function markOrderPaid(orderNumber: string): void {
  const order = stubState.cmsOrders.find((doc) => doc.orderNumber === orderNumber)
  if (!order) throw new Error(`stub: ordine ${orderNumber} non trovato`)
  order.paymentStatus = 'paid'
}

/** Cambia i campi di un ordine per simulare un documento CMS divergente. */
export function patchStoredOrder(orderNumber: string, patch: Record<string, unknown>): void {
  const order = stubState.cmsOrders.find((doc) => doc.orderNumber === orderNumber)
  if (!order) throw new Error(`stub: ordine ${orderNumber} non trovato`)
  Object.assign(order, patch)
}

/** La mappa chiave -> PaymentIntent vive nel provider, non nel codice applicativo. */
const stripeIntentsByIdempotencyKey = new Map<string, Record<string, unknown>>()

export function resetStripeIntents(): void {
  stripeIntentsByIdempotencyKey.clear()
}

let server: Server | undefined
let baseUrl = ''

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const raw = await readBody(req)

  if (url.pathname === '/api/products' && req.method === 'GET') {
    stubState.productsRequests.push(url.pathname + url.search)
    if (stubState.cmsDelayMs > 0) await delay(stubState.cmsDelayMs)
    if (stubState.cmsProductsStatus !== 200) {
      return sendJson(res, stubState.cmsProductsStatus, { error: 'stub giu' })
    }
    if (stubState.cmsTruncateBody) {
      // Intestazioni di 200 e JSON tagliato: il client deve fallire a
      // interpretare il corpo, non ricevere un catalogo parziale.
      res.writeHead(200, { 'content-type': 'application/json' })
      res.write('{"docs":[{"id":1,')
      res.destroy()
      return
    }
    return sendJson(res, 200, {
      docs: stubState.cmsDocs,
      totalDocs: stubState.cmsTotalDocs ?? stubState.cmsDocs.length,
      hasNextPage: false,
      limit: 200,
      page: 1,
      totalPages: 1,
    })
  }

  if (url.pathname === '/api/orders' && req.method === 'GET') {
    stubState.ordersLookups += 1
    const orderNumber = url.searchParams.get('where[orderNumber][equals]')
    const docs = orderNumber
      ? stubState.cmsOrders.filter((doc) => doc.orderNumber === orderNumber)
      : []
    return sendJson(res, 200, { docs })
  }

  if (url.pathname === '/api/orders' && req.method === 'POST') {
    const body = raw ? JSON.parse(raw) as Record<string, unknown> : {}
    stubState.orderPostAttempts += 1
    // Il campo unico del CMS: un secondo documento con lo stesso
    // orderNumber non entra. La corsa la risolve il chiamante rileggendo.
    if (stubState.cmsOrders.some((doc) => doc.orderNumber === body.orderNumber)) {
      return sendJson(res, 409, { error: 'orderNumber deve essere unico' })
    }
    const doc: Record<string, unknown> = {
      ...body,
      id: 1000 + stubState.ordersCreated + 1,
      paymentStatus: 'pending',
      stripePaymentIntentId: null,
    }
    stubState.cmsOrders.push(doc)
    stubState.orderPosts.push(doc)
    stubState.ordersCreated += 1
    return sendJson(res, 200, doc)
  }

  if (url.pathname === '/vies' && req.method === 'POST') {
    stubState.viesRequests += 1
    if (stubState.viesStatus !== 200) return sendJson(res, stubState.viesStatus, { error: 'vies giu' })
    return sendJson(res, 200, stubState.viesValid
      ? { valid: true, name: 'Studio Test Srl', address: 'Via Test 1, Torino' }
      : { valid: false })
  }

  if (url.pathname === '/stripe/v1/payment_intents' && req.method === 'POST') {
    const params = Object.fromEntries(new URLSearchParams(raw))
    const rawKey = req.headers['idempotency-key']
    const key = typeof rawKey === 'string' ? rawKey : ''
    stubState.stripeIdempotencyKeys.push(key)

    // Il provider ricorda la chiave: la stessa chiave restituisce la stessa
    // PaymentIntent senza crearne una seconda.
    if (key) {
      const existing = stripeIntentsByIdempotencyKey.get(key)
      if (existing) return sendJson(res, 200, existing)
    }

    const id = `pi_test_${stubState.stripeIntents.length + 1}`
    const intent: Record<string, unknown> = {
      id,
      object: 'payment_intent',
      amount: Number(params.amount),
      currency: params.currency ?? 'eur',
      client_secret: `${id}_secret_test`,
      status: 'requires_payment_method',
      created: 1,
      livemode: false,
    }
    stubState.stripeIntents.push(params)
    stubState.stripeIntentResponses.push(intent)
    if (key) stripeIntentsByIdempotencyKey.set(key, intent)

    if (stubState.stripeTimeoutAfterRegister) {
      // La intent esiste gia' nel provider; e' solo la risposta a perdersi.
      stubState.stripeTimeoutAfterRegister = false
      res.destroy()
      return
    }

    return sendJson(res, 200, intent)
  }

  return sendJson(res, 404, { error: `stub senza risposta per ${req.method} ${url.pathname}` })
}

export async function startStub(): Promise<string> {
  server = createServer((req, res) => {
    handler(req, res).catch((err: unknown) => {
      res.statusCode = 500
      res.end(String(err))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('stub HTTP senza porta')
  baseUrl = `http://127.0.0.1:${address.port}`
  return baseUrl
}

export async function stopStub(): Promise<void> {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = undefined
}

/**
 * Riscrive fetch verso lo stub e blocca qualunque altro host.
 * Stripe usa `Stripe.createFetchHttpClient()`, quindi passa di qui.
 */
export function installFetchRouting(): void {
  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
    if (raw.startsWith(baseUrl)) return realFetch(raw, init)

    const url = new URL(raw)
    if (url.hostname === 'api.stripe.com') {
      return realFetch(`${baseUrl}/stripe${url.pathname}${url.search}`, init)
    }
    if (url.hostname === 'ec.europa.eu') {
      return realFetch(`${baseUrl}/vies`, init)
    }
    throw new Error(`rete reale in test non consentita: ${raw}`)
  }) as typeof fetch
}
