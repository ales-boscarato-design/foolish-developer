/**
 * Test della rotta Printful che crea l'ordine di stampa.
 *
 * Perche' esiste: e' l'unico punto in cui un indirizzo sbagliato diventa un
 * pacco spedito. Dal 2025 l'API Stripe non popola piu' `session.shipping_details`
 * (l'indirizzo vive in `collected_information.shipping_details`), quindi il
 * webhook che legge solo il campo legacy finisce SEMPRE sul fallback dei
 * metadata. Sul riordino i metadata portano l'indirizzo del vecchio ordine:
 * significa rispedire al vecchio indirizzo di un cliente che ne ha inserito uno
 * nuovo nel checkout. Il test guarda il corpo vero della POST a Printful.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { NextRequest } from 'next/server'

const WEBHOOK_SECRET = 'whsec_printful_test'
const PRINTFUL_CREATE_URL = 'https://api.printful.com/orders'

process.env.STRIPE_PRINTFUL_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy'
process.env.PRINTFUL_API_KEY = 'printful-test-key'
process.env.PAYLOAD_PUBLIC_URL = 'https://cms.test'
process.env.PAYLOAD_API_SECRET = 'cms-test-secret'

import Stripe from 'stripe'

import { POST } from './route'

interface Captured {
  url: string
  method: string
  body?: { recipient?: Record<string, string | undefined> } & Record<string, unknown>
}

let captured: Captured[] = []
let printfulOrderExists = false

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method ?? 'GET').toUpperCase()
  captured.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })

  // Catalogo CMS: una riga merch con sync variant Printful.
  if (url.startsWith('https://cms.test/api/products')) {
    return new Response(
      JSON.stringify({ docs: [{ variants: [{ sku: 'TS-A4', printfulSyncVariantId: '4011' }] }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }

  // Idempotenza: GET /orders/@<external_id>.
  if (url.startsWith(`${PRINTFUL_CREATE_URL}/@`)) {
    return new Response('{}', { status: printfulOrderExists ? 200 : 404 })
  }
  if (url === PRINTFUL_CREATE_URL && method === 'POST') {
    return new Response(JSON.stringify({ result: { id: 1 } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  throw new Error(`fetch inattesa nel test: ${method} ${url}`)
}) as typeof fetch

test.after(() => {
  globalThis.fetch = realFetch
})

const ORDER_REF = 'FOOLISH-1700000000000'
const OLD_ADDRESS = 'Via Vecchia 1|Torino|10100'

interface SessionOverrides {
  collected?: unknown
  legacy?: unknown
  metadata?: Record<string, string>
}

function sessionEvent(overrides: SessionOverrides = {}): Record<string, unknown> {
  const session: Record<string, unknown> = {
    id: 'cs_test_printful_1',
    object: 'checkout.session',
    mode: 'payment',
    payment_status: 'paid',
    amount_total: 2390,
    customer_details: { name: 'Mario Rossi', email: 'mario@example.com' },
    metadata: {
      order_ref: ORDER_REF,
      customer_name: 'Mario Rossi',
      customer_country: 'IT',
      // Indirizzo del PRIMO ordine: sul riordino resta vecchio per costruzione
      // (reorder.ts lo ricava dall'ordine precedente, non dal checkout nuovo).
      customer_address: OLD_ADDRESS,
      items_json: JSON.stringify([
        { sku: 'TS-A4', qty: 1, name: 'T-Sheet A4', variantLabel: 'A4', price: 23.9 },
      ]),
      ...overrides.metadata,
    },
  }
  if (overrides.collected !== undefined) session.collected_information = overrides.collected
  if (overrides.legacy !== undefined) session.shipping_details = overrides.legacy
  return session
}

async function deliver(overrides: SessionOverrides = {}): Promise<void> {
  captured = []
  printfulOrderExists = false
  const payload = JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: sessionEvent(overrides) },
  })
  const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  })
  const req = new NextRequest('http://localhost:3000/api/webhook/printful-fulfillment', {
    method: 'POST',
    body: payload,
    headers: { 'stripe-signature': signature },
  })
  const res = await POST(req)
  assert.equal(res.status, 200)
}

function printfulRecipient(): Record<string, string | undefined> {
  const create = captured.find((c) => c.url === PRINTFUL_CREATE_URL && c.method === 'POST')
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.ok(create.body?.recipient, 'la POST a Printful non ha un recipient')
  return create.body.recipient
}

test('sessione con SOLO collected_information: spedisce al nuovo indirizzo del checkout', async () => {
  await deliver({
    collected: {
      shipping_details: {
        // Nome diverso da quello dei metadata (spedizione a terzi): sul riordino
        // i metadata portano ancora il nome del primo ordine.
        name: 'Anna Bianchi',
        address: { line1: 'Via Nuova 99', line2: 'Scala B', city: 'Milano', postal_code: '20100', country: 'IT' },
      },
    },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.name, 'Anna Bianchi')
  assert.equal(recipient.address1, 'Via Nuova 99')
  assert.equal(recipient.address2, 'Scala B')
  assert.equal(recipient.city, 'Milano')
  assert.equal(recipient.zip, '20100')
  assert.equal(recipient.country_code, 'IT')
  // Il vecchio indirizzo dei metadata non deve comparire da nessuna parte.
  assert.notEqual(recipient.address1, 'Via Vecchia 1')
  assert.notEqual(recipient.city, 'Torino')
})

test('sessione con SOLO shipping_details legacy: continua a funzionare (nessuna regressione)', async () => {
  await deliver({
    legacy: {
      address: { line1: 'Via Legacy 7', line2: '', city: 'Bologna', postal_code: '40100', country: 'IT' },
    },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.address1, 'Via Legacy 7')
  assert.equal(recipient.city, 'Bologna')
  assert.equal(recipient.zip, '40100')
})

test('nessuna delle due fonti: usa il fallback sui metadata (ordini vecchi)', async () => {
  await deliver()

  const recipient = printfulRecipient()
  assert.equal(recipient.name, 'Mario Rossi')
  assert.equal(recipient.address1, 'Via Vecchia 1')
  assert.equal(recipient.city, 'Torino')
  assert.equal(recipient.zip, '10100')
  assert.equal(recipient.country_code, 'IT')
})

test('collected_information senza indirizzo: ricade su legacy, non su un indirizzo vuoto', async () => {
  await deliver({
    collected: { shipping_details: { name: 'Mario Rossi', address: null } },
    legacy: { address: { line1: 'Via Legacy 7', city: 'Bologna', postal_code: '40100', country: 'IT' } },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.address1, 'Via Legacy 7')
  assert.equal(recipient.city, 'Bologna')
})

test('indirizzo parziale: usa quello nuovo e NON lo completa col vecchio', async () => {
  await deliver({
    collected: {
      shipping_details: { address: { line1: 'Via Nuova 99', country: 'IT' } },
    },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.address1, 'Via Nuova 99')
  // Nessun campo preso in prestito dal vecchio ordine: meglio un ordine che
  // Printful rifiuta (trattabile a mano) che un pacco al vecchio indirizzo.
  assert.equal(recipient.city, '')
  assert.equal(recipient.zip, '')
})

test('paese non italiano: arriva nella POST in maiuscolo, nessun default Italia', async () => {
  await deliver({
    collected: {
      shipping_details: {
        name: 'Claire Dubois',
        address: { line1: '12 Rue de Rivoli', city: 'Paris', postal_code: '75001', country: 'fr' },
      },
    },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.name, 'Claire Dubois')
  assert.equal(recipient.address1, '12 Rue de Rivoli')
  assert.equal(recipient.city, 'Paris')
  assert.equal(recipient.zip, '75001')
  assert.equal(recipient.country_code, 'FR')
})

test('ordine normale: entrambe le fonti concordano, spedisce all indirizzo giusto', async () => {
  await deliver({
    collected: {
      shipping_details: {
        address: { line1: 'Via Vecchia 1', city: 'Torino', postal_code: '10100', country: 'IT' },
      },
    },
    legacy: { address: { line1: 'Via Vecchia 1', city: 'Torino', postal_code: '10100', country: 'IT' } },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.address1, 'Via Vecchia 1')
  assert.equal(recipient.city, 'Torino')
  assert.equal(recipient.zip, '10100')
})

test('ordine Printful già esistente: nessuna seconda POST (idempotenza invariata)', async () => {
  captured = []
  printfulOrderExists = true
  const payload = JSON.stringify({
    id: 'evt_test_2',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: sessionEvent({
        collected: {
          shipping_details: { address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' } },
        },
      }),
    },
  })
  const signature = new Stripe('sk_test_dummy').webhooks.generateTestHeaderString({
    payload,
    secret: WEBHOOK_SECRET,
  })
  const res = await POST(
    new NextRequest('http://localhost:3000/api/webhook/printful-fulfillment', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': signature },
    }),
  )
  assert.equal(res.status, 200)
  assert.equal(captured.filter((c) => c.url === PRINTFUL_CREATE_URL && c.method === 'POST').length, 0)
})
