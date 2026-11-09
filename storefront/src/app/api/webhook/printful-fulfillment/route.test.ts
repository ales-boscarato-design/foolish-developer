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
process.env.NANOBOT_WEBHOOK_URL = 'https://nanobot.test'
process.env.NANOBOT_WEBHOOK_SECRET = 'nanobot-test-secret'

import Stripe from 'stripe'

import { POST } from './route'

interface Captured {
  url: string
  method: string
  body?: { recipient?: Record<string, string | undefined> } & Record<string, unknown>
}

let captured: Captured[] = []
let printfulOrderExists = false
/** Riferimenti per cui Printful considera gia' esistente l'ordine (GET /orders/@ref). */
let printfulExistingRefs: string[] = []
/** Ordini presenti nel CMS finto, interrogabili per `orderNumber` o `stripeSessionId`. */
let cmsOrders: Array<{ orderNumber: string; stripeSessionId?: string }> = []
/** Se valorizzato, la ricerca ordini sul CMS fallisce con questo status. */
let cmsOrdersFailure: number | null = null
/** Payload degli avvisi operativi inviati al ricevitore. */
let alerts: Array<Record<string, unknown>> = []

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

  // Ricerca dell'ordine nel CMS: `findCmsOrder` (orderNumber) e
  // `findCmsOrderBySessionId` (stripeSessionId).
  if (url.startsWith('https://cms.test/api/orders')) {
    if (cmsOrdersFailure !== null) {
      return new Response('cms orders unavailable', { status: cmsOrdersFailure })
    }
    const parsed = new URL(url)
    const orderNumber = parsed.searchParams.get('where[orderNumber][equals]')
    const stripeSessionId = parsed.searchParams.get('where[stripeSessionId][equals]')
    const docs = cmsOrders.filter((order) =>
      orderNumber ? order.orderNumber === orderNumber : order.stripeSessionId === stripeSessionId,
    )
    return new Response(JSON.stringify({ docs }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  // Avvisi operativi al ricevitore (hook firmato).
  if (url.startsWith('https://nanobot.test/hooks/')) {
    alerts.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }

  // Idempotenza: GET /orders/@<external_id>.
  if (url.startsWith(`${PRINTFUL_CREATE_URL}/@`)) {
    const ref = decodeURIComponent(url.slice(`${PRINTFUL_CREATE_URL}/@`.length))
    const exists = printfulOrderExists || printfulExistingRefs.includes(ref)
    return new Response('{}', { status: exists ? 200 : 404 })
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
  /** Sessione il cui checkout NON ha dichiarato `order_ref` nei metadata. */
  omitOrderRef?: boolean
  /** `checkout.session.mode` (default: pagamento singolo). */
  mode?: string
  /** `checkout.session.payment_status` (default: paid). */
  paymentStatus?: string
}

function sessionEvent(overrides: SessionOverrides = {}): Record<string, unknown> {
  const metadata: Record<string, string> = {
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
  }
  if (overrides.omitOrderRef) delete metadata.order_ref
  const session: Record<string, unknown> = {
    id: 'cs_test_printful_1',
    object: 'checkout.session',
    mode: overrides.mode ?? 'payment',
    payment_status: overrides.paymentStatus ?? 'paid',
    amount_total: 2390,
    customer_details: { name: 'Mario Rossi', email: 'mario@example.com' },
    metadata,
  }
  if (overrides.collected !== undefined) session.collected_information = overrides.collected
  if (overrides.legacy !== undefined) session.shipping_details = overrides.legacy
  return session
}

interface DeliverOptions extends SessionOverrides {
  /** Ordini presenti nel CMS finto, interrogabili per `orderNumber` o `stripeSessionId`. */
  cmsOrders?: Array<{ orderNumber: string; stripeSessionId?: string }>
  /** Se valorizzato, la ricerca ordini sul CMS fallisce con questo status. */
  cmsOrdersFailure?: number
  /** Riferimenti per cui Printful considera gia' esistente l'ordine. */
  printfulExistingRefs?: string[]
  /** Status atteso della rotta (default 200: il percorso che gia' funziona). */
  expectedStatus?: number
}

async function deliver(options: DeliverOptions = {}): Promise<Response> {
  captured = []
  printfulOrderExists = false
  printfulExistingRefs = options.printfulExistingRefs ?? []
  cmsOrders = options.cmsOrders ?? []
  cmsOrdersFailure = options.cmsOrdersFailure ?? null
  alerts = []
  const payload = JSON.stringify({
    id: 'evt_test_1',
    object: 'event',
    type: 'checkout.session.completed',
    data: { object: sessionEvent(options) },
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
  assert.equal(res.status, options.expectedStatus ?? 200)
  return res
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

test('conflitto: collected e legacy convivono con indirizzi diversi, vince collected', async () => {
  // Caso che discrimina l'ORDINE di precedenza sul punto che spedisce il pacco:
  // il vecchio ordine (legacy) e i metadata portano l'indirizzo vecchio, il
  // checkout nuovo ne porta un altro. Se la precedenza fosse invertita il pacco
  // partirebbe per Torino.
  await deliver({
    collected: {
      shipping_details: {
        name: 'Anna Bianchi',
        address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' },
      },
    },
    legacy: {
      address: { line1: 'Via Legacy 7', city: 'Bologna', postal_code: '40100', country: 'IT' },
    },
  })

  const recipient = printfulRecipient()
  assert.equal(recipient.address1, 'Via Nuova 99')
  assert.equal(recipient.city, 'Milano')
  assert.equal(recipient.zip, '20100')
  assert.equal(recipient.name, 'Anna Bianchi')
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

// ── Riferimento dell'ordine: non si inventa ────────────────────────────────────
//
// Il codice vecchio faceva `meta.order_ref ?? \`FOOLISH-${session.id}\``. Il riferimento
// inventato non corrispondeva a nessun ordine del CMS: il pacco partiva per un pagamento
// che nel CMS non esisteva (senza tracking ne' email) e la chiave di deduplicazione non
// era quella dell'ordine reale. I test qui sotto coprono il confine HTTP: con un ordine
// CMS raggiungibile si usa il SUO numero, senza ordine si risponde NON-2xx e si avvisa,
// e i pacchi gia' creati col riferimento legacy vengono ritrovati invece che duplicati.

const CMS_ORDER_NUMBER = 'FOOLISH-0123456789abcdef0123456789abcdef'

function printfulCreateRequest() {
  return captured.find((c) => c.url === PRINTFUL_CREATE_URL && c.method === 'POST')
}

function printfulLookups(): string[] {
  return captured
    .filter((c) => c.url.startsWith(`${PRINTFUL_CREATE_URL}/@`))
    .map((c) => decodeURIComponent(c.url.slice(`${PRINTFUL_CREATE_URL}/@`.length)))
}

test('sessione senza order_ref con ordine CMS esistente: usa il numero dell ordine, non l id di sessione', async () => {
  await deliver({
    omitOrderRef: true,
    cmsOrders: [{ orderNumber: CMS_ORDER_NUMBER, stripeSessionId: 'cs_test_printful_1' }],
  })

  const create = printfulCreateRequest()
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.equal(create.body?.external_id, CMS_ORDER_NUMBER)
  // La ricerca avviene sulla chiave di sessione, non su un numero inventato.
  assert.ok(captured.some((c) => c.url.includes('where[stripeSessionId][equals]=cs_test_printful_1')))
  assert.deepEqual(printfulLookups(), [CMS_ORDER_NUMBER])
  assert.ok(!captured.some((c) => c.url.includes('FOOLISH-cs_test_printful_1')))
  assert.equal(alerts.length, 0)
})

test('sessione senza order_ref e senza ordine CMS: nessun ordine di stampa, 503 e avviso', async () => {
  const res = await deliver({ omitOrderRef: true, cmsOrders: [], expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.error, 'order_reference_unresolved')
  assert.equal(body.code, 'order_ref_unresolved')
  assert.equal(printfulCreateRequest(), undefined, 'nessun ordine di stampa senza un riferimento risolto')
  // L'unica chiamata a Printful e' la ricerca del riferimento legacy: nessuna create.
  assert.deepEqual(printfulLookups(), ['FOOLISH-cs_test_printful_1'])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].eventType, 'printful_fulfillment_alert')
  assert.equal(alerts[0].reason, 'order_ref_unresolved')
  assert.equal(alerts[0].stripeSessionId, 'cs_test_printful_1')
  assert.equal(alerts[0].legacyPrintfulOrderExists, false)
})

test('legacy: un pacco gia creato con FOOLISH-<session.id> viene ritrovato, non duplicato', async () => {
  const res = await deliver({
    omitOrderRef: true,
    cmsOrders: [],
    printfulExistingRefs: ['FOOLISH-cs_test_printful_1'],
  })
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.legacyOrderRef, 'FOOLISH-cs_test_printful_1')
  assert.equal(printfulCreateRequest(), undefined, 'nessun secondo ordine di stampa')
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].legacyPrintfulOrderExists, true)
  assert.equal(alerts[0].orderRef, 'FOOLISH-cs_test_printful_1')
})

test('ordine CMS legacy senza stripeSessionId: ritrovato per numero, stessa chiave di stampa', async () => {
  await deliver({
    omitOrderRef: true,
    cmsOrders: [{ orderNumber: 'FOOLISH-cs_test_printful_1' }],
  })

  const create = printfulCreateRequest()
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.equal(create.body?.external_id, 'FOOLISH-cs_test_printful_1')
  // Il numero arriva dalla lettura del CMS, non da una stringa costruita a mano.
  assert.ok(captured.some((c) => c.url.includes('where[orderNumber][equals]=FOOLISH-cs_test_printful_1')))
})

test('order_ref dichiarato: nessuna ricerca sul CMS, la POST usa il numero dichiarato', async () => {
  await deliver({ cmsOrders: [{ orderNumber: 'altro-ordine' }] })

  const create = printfulCreateRequest()
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.equal(create.body?.external_id, ORDER_REF)
  assert.equal(captured.filter((c) => c.url.startsWith('https://cms.test/api/orders')).length, 0)
})

test('CMS non disponibile durante la risoluzione: 503 e nessun ordine di stampa', async () => {
  const res = await deliver({ omitOrderRef: true, cmsOrdersFailure: 500, expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.error, 'order_reference_lookup_failed')
  assert.equal(printfulCreateRequest(), undefined)
})

test('sessione senza order_ref e senza righe merch: nessun allarme, 200', async () => {
  await deliver({ omitOrderRef: true, metadata: { items_json: '[]' } })

  assert.equal(alerts.length, 0)
  assert.equal(printfulLookups().length, 0)
})

test('ordine CMS legacy e pacco legacy entrambi presenti: nessun secondo pacco', async () => {
  await deliver({
    omitOrderRef: true,
    cmsOrders: [{ orderNumber: 'FOOLISH-cs_test_printful_1' }],
    printfulExistingRefs: ['FOOLISH-cs_test_printful_1'],
  })

  assert.equal(printfulCreateRequest(), undefined, 'nessun secondo ordine di stampa')
  assert.ok(printfulLookups().includes('FOOLISH-cs_test_printful_1'))
  assert.equal(alerts.length, 0)
})

test('sessione abbonamento: nessuna stampa e nessun allarme', async () => {
  await deliver({ mode: 'subscription', omitOrderRef: true })

  assert.equal(printfulCreateRequest(), undefined)
  assert.equal(alerts.length, 0)
})

test('sessione non pagata: nessuna stampa e nessun allarme', async () => {
  await deliver({ paymentStatus: 'unpaid', omitOrderRef: true })

  assert.equal(printfulCreateRequest(), undefined)
  assert.equal(printfulLookups().length, 0)
  assert.equal(alerts.length, 0)
})
