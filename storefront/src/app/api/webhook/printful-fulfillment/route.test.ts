import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import Stripe from 'stripe'

import { POST } from './route'

// Chiavi finte: il test non parla con nessuna rete (fetch è intercettata) e la
// firma è generata dalla SDK con lo stesso segreto del webhook.
const WEBHOOK_SECRET = 'whsec_printful_test'
process.env.STRIPE_PRINTFUL_WEBHOOK_SECRET = WEBHOOK_SECRET
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder'
process.env.PRINTFUL_API_KEY = 'printful-fake-key'
process.env.PAYLOAD_API_SECRET = 'storefront-fake-secret'
process.env.PAYLOAD_PUBLIC_URL = 'https://cms.invalid'

const MERCH_ITEM = { sku: 'MERCH-1', qty: 1, name: 'Tee', variantLabel: 'M', price: 30 }

/** Evento `checkout.session.completed` con la sessione indicata. */
function eventFor(session: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'evt_printful_1',
    object: 'event',
    api_version: '2026-04-22.dahlia',
    created: 1_700_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test_printful',
        object: 'checkout.session',
        mode: 'payment',
        payment_status: 'paid',
        customer_details: { name: 'Cliente Di Prova' },
        metadata: { order_ref: 'FOOLISH-1001', items_json: JSON.stringify([MERCH_ITEM]) },
        ...session,
      },
    },
  }
}

interface Interception {
  printfulOrder: Record<string, unknown> | null
  calls: string[]
}

async function deliver(event: unknown): Promise<{
  status: number
  body: unknown
  interception: Interception
}> {
  const originalFetch = globalThis.fetch
  const interception: Interception = { printfulOrder: null, calls: [] }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    interception.calls.push(url)

    if (url.includes('/api/products')) {
      return new Response(
        JSON.stringify({ docs: [{ variants: [{ sku: MERCH_ITEM.sku, printfulSyncVariantId: '777' }] }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    if (url.includes('api.printful.com/orders/@')) {
      return new Response('not found', { status: 404 })
    }
    if (url.includes('api.printful.com/orders')) {
      interception.printfulOrder = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>
      return new Response(JSON.stringify({ code: 200, result: { id: 1 } }), { status: 200 })
    }
    throw new Error(`fetch inattesa nel test: ${url}`)
  }) as typeof fetch

  try {
    const payload = JSON.stringify(event)
    const signature = new Stripe('sk_test_placeholder').webhooks.generateTestHeaderString({
      payload,
      secret: WEBHOOK_SECRET,
    })
    const request = new NextRequest('http://localhost/api/webhook/printful-fulfillment', {
      method: 'POST',
      body: payload,
      headers: { 'stripe-signature': signature },
    })
    const response = await POST(request)
    return { status: response.status, body: await response.json(), interception }
  } finally {
    globalThis.fetch = originalFetch
  }
}

function recipientOf(interception: Interception): Record<string, unknown> {
  assert.ok(interception.printfulOrder, 'nessun ordine Printful creato')
  const recipient = interception.printfulOrder.recipient
  assert.ok(recipient && typeof recipient === 'object', 'ordine Printful senza destinatario')
  return recipient as Record<string, unknown>
}

test('l\'ordine Printful parte verso l\'indirizzo confermato nella sessione', async () => {
  // Un riordino scrive nei metadata `customer_address` dell'ordine di partenza:
  // se il cliente conferma un indirizzo diverso nella sessione, la merce deve
  // partire verso quello nuovo, non verso la via vecchia.
  const { status, interception } = await deliver(eventFor({
    collected_information: {
      shipping_details: {
        name: 'Cliente Di Prova',
        address: {
          line1: 'Via Nuova 99',
          line2: 'Scala B',
          city: 'Chieri',
          postal_code: '10023',
          country: 'IT',
        },
      },
    },
    metadata: {
      order_ref: 'FOOLISH-1001',
      items_json: JSON.stringify([MERCH_ITEM]),
      customer_name: 'Cliente Di Prova',
      customer_address: 'Via Vecchia 1|Torino|10100',
      customer_country: 'IT',
      reorder_from: 'FOOLISH-900',
    },
  }))

  assert.equal(status, 200)
  assert.deepEqual(recipientOf(interception), {
    name: 'Cliente Di Prova',
    address1: 'Via Nuova 99',
    address2: 'Scala B',
    city: 'Chieri',
    zip: '10023',
    country_code: 'IT',
  })
})

test('senza indirizzo raccolto si ripiega sui metadata (sessioni storiche)', async () => {
  const { interception } = await deliver(eventFor({
    collected_information: null,
    metadata: {
      order_ref: 'FOOLISH-1002',
      items_json: JSON.stringify([MERCH_ITEM]),
      customer_name: 'Cliente Di Prova',
      customer_address: 'Via Vecchia 1|Torino|10100',
      customer_country: 'IT',
    },
  }))

  const recipient = recipientOf(interception)
  assert.equal(recipient.address1, 'Via Vecchia 1')
  assert.equal(recipient.city, 'Torino')
  assert.equal(recipient.zip, '10100')
})

test('senza righe merch non parte nessun ordine Printful', async () => {
  const { status, body, interception } = await deliver(eventFor({
    metadata: { order_ref: 'FOOLISH-1003', items_json: JSON.stringify([]) },
  }))

  assert.equal(status, 200)
  assert.deepEqual(body, { received: true })
  assert.equal(interception.printfulOrder, null)
  assert.deepEqual(interception.calls, [])
})

test('un items_json che non è una lista non fa fallire il fulfillment', async () => {
  // La differenza osservabile della guardia è l'assenza dell'errore nel log: senza
  // di essa l'iterazione su un oggetto lancia e finisce in `catch` come se il
  // fulfillment fosse fallito.
  const errors: unknown[][] = []
  const originalError = console.error
  console.error = ((...args: unknown[]) => {
    errors.push(args)
  }) as typeof console.error

  try {
    const { status, body, interception } = await deliver(eventFor({
      metadata: { order_ref: 'FOOLISH-1004', items_json: '{"sku":"MERCH-1"}' },
    }))

    assert.equal(status, 200)
    assert.deepEqual(body, { received: true })
    assert.equal(interception.printfulOrder, null)
    assert.deepEqual(interception.calls, [])
    assert.deepEqual(errors, [], 'metadata fuori forma non deve produrre un errore')
  } finally {
    console.error = originalError
  }
})

test('una firma non valida non crea ordini', async () => {
  const originalFetch = globalThis.fetch
  let called = false
  globalThis.fetch = (async () => {
    called = true
    return new Response('{}', { status: 200 })
  }) as typeof fetch

  try {
    const request = new NextRequest('http://localhost/api/webhook/printful-fulfillment', {
      method: 'POST',
      body: JSON.stringify(eventFor({})),
      headers: { 'stripe-signature': 't=1,v1=deadbeef' },
    })
    const response = await POST(request)
    assert.equal(response.status, 401)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = originalFetch
  }
})
