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
// Canale degli avvisi operativi: senza URL e segreto `notifyNanobot` non invia
// nulla e il test non vedrebbe la differenza fra "avviso mandato" e "nessun avviso".
process.env.NANOBOT_WEBHOOK_URL = 'https://nanobot.test'
process.env.NANOBOT_WEBHOOK_SECRET = 'nanobot-test-secret'

import Stripe from 'stripe'

import { POST } from './route'

interface Captured {
  url: string
  method: string
  body?: { recipient?: Record<string, string | undefined> } & Record<string, unknown>
}

interface CapturedAlert {
  path: string
  body: Record<string, unknown>
}

let captured: Captured[] = []
let alerts: CapturedAlert[] = []
let printfulOrderExists = false
/** Riferimenti per cui Printful considera gia' esistente l'ordine (GET /orders/@ref). */
let printfulExistingRefs: string[] = []
/** Ordini presenti nel CMS finto, interrogabili per `orderNumber` o `stripeSessionId`. */
let cmsOrders: Array<{ orderNumber: string; stripeSessionId?: string }> = []
/** Se valorizzato, la ricerca ordini sul CMS fallisce con questo status. */
let cmsOrdersFailure: number | null = null
let printfulCreateStatus = 200
/** Corpo grezzo della risposta di errore della create (default: il corpo con PII). */
let printfulCreateBody: string | null = null
let nanobotFails = false
let catalogFails = false
let createNetworkError = false
/**
 * Status da restituire alle GET /orders/@<ref>, consumati in ordine; esaurita la
 * coda vale il comportamento normale (`printfulOrderExists` / `printfulExistingRefs`).
 * Serve a distinguere i due lookup della rotta: quello PRIMA della create e quello
 * di verifica dopo un errore ambiguo.
 */
let printfulLookupQueuedStatuses: number[] = []
/** Righe di `console.log` emesse durante la richiesta (per i log strutturati). */
let logs: string[] = []

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  const method = (init?.method ?? 'GET').toUpperCase()

  // Avvisi operativi (notifyNanobot): stessa fetch del resto del codice.
  if (url.startsWith('https://nanobot.test')) {
    alerts.push({
      path: url.slice('https://nanobot.test'.length),
      body: JSON.parse(String(init?.body ?? '{}')),
    })
    if (nanobotFails) throw new Error('nanobot irraggiungibile (test)')
    return new Response('{}', { status: 200 })
  }

  captured.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined })

  // Catalogo CMS: una riga merch con sync variant Printful.
  if (url.startsWith('https://cms.test/api/products')) {
    if (catalogFails) throw new Error('CMS irraggiungibile (test)')
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

  // Idempotenza: GET /orders/@<external_id>.
  if (url.startsWith(`${PRINTFUL_CREATE_URL}/@`)) {
    const queued = printfulLookupQueuedStatuses.shift()
    if (queued !== undefined) return new Response('{}', { status: queued })
    const ref = decodeURIComponent(url.slice(`${PRINTFUL_CREATE_URL}/@`.length))
    const exists = printfulOrderExists || printfulExistingRefs.includes(ref)
    return new Response('{}', { status: exists ? 200 : 404 })
  }
  if (url === PRINTFUL_CREATE_URL && method === 'POST') {
    if (createNetworkError) throw new Error('ECONNRESET (test)')
    if (printfulCreateStatus !== 200) {
      if (printfulCreateBody !== null) {
        return new Response(printfulCreateBody, {
          status: printfulCreateStatus,
          headers: { 'content-type': 'application/json' },
        })
      }
      // Il corpo dell'errore contiene il destinatario: e' il caso peggiore per
      // l'avviso, che deve restare pulito anche quando Printful rimanda i dati.
      return new Response(
        JSON.stringify({
          error: {
            message: 'invalid recipient',
            recipient: { name: 'Anna Bianchi', address1: 'Via Nuova 99', city: 'Milano', email: 'anna@example.com' },
          },
        }),
        { status: printfulCreateStatus, headers: { 'content-type': 'application/json' } },
      )
    }
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
  if (overrides.omitOrderRef) delete (session.metadata as Record<string, string>).order_ref
  if (overrides.mode !== undefined) session.mode = overrides.mode
  if (overrides.paymentStatus !== undefined) session.payment_status = overrides.paymentStatus
  return session
}

interface DeliverOptions {
  createStatus?: number
  /** Corpo grezzo della risposta di errore della create (per i casi che citano `external_id`). */
  createBody?: string
  nanobotDown?: boolean
  catalogDown?: boolean
  createNetworkDown?: boolean
  /** Ordini presenti nel CMS finto, interrogabili per `orderNumber` o `stripeSessionId`. */
  cmsOrders?: Array<{ orderNumber: string; stripeSessionId?: string }>
  /** Se valorizzato, la ricerca ordini sul CMS fallisce con questo status. */
  cmsOrdersFailure?: number
  /** Riferimenti per cui Printful considera gia' esistente l'ordine. */
  printfulExistingRefs?: string[]
  /** Status in coda per le GET /orders/@<ref> (prima la verifica pre-create, poi quella dopo un errore). */
  printfulLookupStatuses?: number[]
  /** Status atteso della rotta (default 200: il percorso che gia' funziona). */
  expectedStatus?: number
}

async function deliver(overrides: SessionOverrides = {}, opts: DeliverOptions = {}): Promise<Response> {
  captured = []
  alerts = []
  printfulOrderExists = false
  printfulExistingRefs = opts.printfulExistingRefs ?? []
  cmsOrders = opts.cmsOrders ?? []
  cmsOrdersFailure = opts.cmsOrdersFailure ?? null
  printfulCreateStatus = opts.createStatus ?? 200
  printfulCreateBody = opts.createBody ?? null
  nanobotFails = opts.nanobotDown ?? false
  catalogFails = opts.catalogDown ?? false
  createNetworkError = opts.createNetworkDown ?? false
  printfulLookupQueuedStatuses = [...(opts.printfulLookupStatuses ?? [])]
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
  // I log strutturati sono parte del comportamento richiesto (es.
  // `already_created_after_error`): si catturano invece di stamparli, cosi' un test
  // puo' pretendere la riga esatta senza dipendere dall'output del runner.
  const originalLog = console.log
  logs = []
  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '))
  }
  let res: Response
  try {
    res = await POST(req)
  } finally {
    console.log = originalLog
  }
  assert.equal(
    res.status,
    opts.expectedStatus ?? 200,
    `status inatteso ${res.status}; log della rotta: ${logs.join(' | ') || '(nessuno)'}`,
  )
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

// ── Avvisi operativi ─────────────────────────────────────────────────────────────
//
// Perche' questi test: la rotta risponde SEMPRE 200 (un ordine gia' registrato nel
// CMS non deve far ritentare Stripe), quindi un indirizzo incompleto o un rifiuto
// di Printful non lasciano altra traccia che un log. Il rischio misurato e' un
// ordine merch mai stampato e scoperto giorni dopo. L'avviso deve partire in
// entrambi i casi, e deve contenere solo riferimenti: nome, indirizzo ed email
// del cliente non appartengono a un canale di notifica.

const ALERT_HOOK = '/hooks/foolish-printful-fulfillment'
const PII_MARKERS = ['Via Vecchia 1', 'Via Nuova 99', 'Torino', 'Milano', 'Mario Rossi', 'Anna Bianchi', 'mario@example.com']

function fulfillmentAlerts(): CapturedAlert[] {
  return alerts.filter((alert) => alert.path === ALERT_HOOK)
}

function alertBody(alert: CapturedAlert): string {
  return JSON.stringify(alert.body)
}

function assertNoPersonalData(alert: CapturedAlert): void {
  const text = alertBody(alert)
  for (const marker of PII_MARKERS) {
    assert.ok(!text.includes(marker), `l'avviso contiene un dato personale (${marker}): ${text}`)
  }
}

test('indirizzo incompleto dai metadata: avviso operativo e risposta 200', async () => {
  // Il caso che la condizione precedente (`source !== 'metadata'`) escludeva: il
  // fallback sui metadata e' proprio quello dei riordini e degli ordini storici,
  // dove mancare un campo e' piu' probabile.
  await deliver({ metadata: { customer_address: 'Via Vecchia 1' } }) // mancano citta' e CAP

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  const [alert] = found
  assert.equal(alert.body.eventType, 'printful_fulfillment_alert')
  assert.equal(alert.body.orderRef, ORDER_REF)
  assert.equal(alert.body.source, 'metadata')
  assert.equal(alert.body.reason, 'indirizzo_incompleto')
  assert.deepEqual(alert.body.missingFields, ['city', 'postalCode'])
  assertNoPersonalData(alert)

  // La rotta continua a tentare la stampa: l'avviso non cambia il flusso.
  printfulRecipient()
})

test('indirizzo incompleto da collected_information: avviso con la fonte giusta', async () => {
  await deliver({ collected: { shipping_details: { address: { line1: 'Via Nuova 99', country: 'IT' } } } })

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.source, 'collected_information')
  assert.equal(found[0].body.reason, 'indirizzo_incompleto')
  assert.deepEqual(found[0].body.missingFields, ['city', 'postalCode'])
  assertNoPersonalData(found[0])
})

test('Printful rifiuta la create (500): avviso operativo e 503 (Stripe ritenta)', async () => {
  // Il difetto misurato nella review della PR #49: con la create fallita la rotta
  // rispondeva 200, Stripe non ritentava e l'ordine pagato restava non stampato.
  const res = await deliver({}, { createStatus: 500, expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.error, 'printful_create_failed')
  assert.equal(body.code, 'printful_create_retryable')
  assert.equal(body.printfulStatus, 500)

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, 500)
  assert.deepEqual(found[0].body.missingFields, [])
  assert.deepEqual(found[0].body.skus, ['TS-A4'])
  assertNoPersonalData(found[0])

  // Il retry e' di Stripe: la rotta non ritenta la POST nella stessa richiesta.
  assert.equal(printfulCreateRequests().length, 1)
})

test('indirizzo completo e Printful disponibile: nessun avviso (caso negativo)', async () => {
  await deliver({
    collected: {
      shipping_details: {
        name: 'Anna Bianchi',
        address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' },
      },
    },
  })

  assert.deepEqual(fulfillmentAlerts(), [], `nessun avviso atteso, ricevuti: ${JSON.stringify(alerts)}`)
  printfulRecipient()
})

test('indirizzo incompleto E Printful lo rifiuta: UN avviso solo, con il motivo del rifiuto', async () => {
  // Due avvisi per lo stesso ordine (uno per l'indirizzo, uno per il rifiuto)
  // direbbero la stessa cosa due volte: chi interviene riceve due messaggi con lo
  // stesso ordine. L'avviso e' uno e porta la causa (i campi) e l'esito (lo stato).
  // Con un 5xx la risposta e' 503 (retryable), non 200.
  await deliver(
    { collected: { shipping_details: { address: { line1: 'Via Nuova 99', country: 'IT' } } } },
    { createStatus: 500, expectedStatus: 503 },
  )

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un solo avviso, ricevuti ${found.length}: ${JSON.stringify(found)}`)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, 500)
  assert.deepEqual(found[0].body.missingFields, ['city', 'postalCode'])
  assertNoPersonalData(found[0])
})

test('avviso irraggiungibile: la rotta resta 200 e l ordine di stampa nasce lo stesso', async () => {
  // L'invariante del webhook: un canale di notifica rotto non deve fermare la
  // stampa ne' far ritentare Stripe su un evento gia' gestito.
  await deliver({ metadata: { customer_address: 'Via Vecchia 1' } }, { nanobotDown: true })

  printfulRecipient() // la POST a Printful e' avvenuta
  assert.equal(fulfillmentAlerts().length, 1, 'il tentativo di avviso deve comunque avvenire')
})

test('errore imprevisto (CMS irraggiungibile): avviso fulfillment_failed e 200', async () => {
  // Il percorso generico del catch esterno: senza avviso, un errore diverso da
  // "indirizzo incompleto" e "Printful 500" resterebbe un log e basta.
  await deliver({}, { catalogDown: true })

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.reason, 'fulfillment_failed')
  assert.equal(found[0].body.orderRef, ORDER_REF)
  assertNoPersonalData(found[0])
})

test('errore di rete sulla create: 503 retryable, avviso con il motivo del fallimento', async () => {
  // Un errore che non e' un rifiuto (connessione, timeout) e' il caso AMBIGUO: la
  // POST puo' essere arrivata lo stesso. Si risponde 503 (Stripe ritenta, e il
  // tentativo successivo rifa' la verifica `external_id` prima di creare) e si
  // avvisa, perche' se l'ordine non esiste nessuno lo stampa da solo.
  const res = await deliver({}, { createNetworkDown: true, expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.code, 'printful_create_retryable')
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, undefined)
  assert.deepEqual(found[0].body.skus, ['TS-A4'])
  assertNoPersonalData(found[0])
})

// ── Doppio invio: un errore puo' significare "ordine gia' creato" ─────────────
//
// Perche' questi test: Printful non documenta `external_id` come chiave di
// idempotenza, quindi un timeout ambiguo e' il punto in cui la rotta puo' creare un
// SECONDO pacco a pagamento. Prima di dichiarare fallita la stampa si cerca l'ordine
// con lo stesso `external_id`; se c'e', il pacco e' partito.

test('create con timeout ma ordine gia creato: 200, nessun nuovo invio, log already_created_after_error', async () => {
  // 1o lookup (prima della create) 404; POST che non risponde; 2o lookup (verifica) 200.
  const res = await deliver(
    {},
    { createNetworkDown: true, printfulLookupStatuses: [404, 200], expectedStatus: 200 },
  )
  const body = await res.json()

  assert.equal(body.received, true)
  // Un solo tentativo di creazione: il secondo invio sarebbe un secondo pacco.
  assert.equal(printfulCreateRequests().length, 1)
  assert.deepEqual(printfulLookups(), [ORDER_REF, ORDER_REF])
  assert.equal(alerts.length, 0, `nessun avviso atteso (il pacco esiste), ricevuti: ${JSON.stringify(alerts)}`)
  assert.ok(
    logs.some((line) => line.includes('already_created_after_error')),
    `log already_created_after_error atteso, ricevuto: ${logs.join(' | ') || '(nessuno)'}`,
  )
})

test('create ambiguo e verifica impossibile: 503 (non 200), cosi il retry rifa la verifica', async () => {
  // La verifica dopo l'errore non risponde: non si sa se il pacco c'e'. Non si crea
  // nulla e si restituisce non-2xx; il tentativo successivo rifa' la verifica.
  const res = await deliver(
    {},
    { createNetworkDown: true, printfulLookupStatuses: [404, 500], expectedStatus: 503 },
  )
  const body = await res.json()

  assert.equal(body.code, 'printful_create_retryable')
  assert.equal(printfulCreateRequests().length, 1)
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, undefined)
  assertNoPersonalData(found[0])
})

test('verifica di esistenza non disponibile prima della create: 503 e avviso, nessuna create', async () => {
  // Printful non risponde al controllo: creare alla cieca rischia un duplicato,
  // non creare lascia l'ordine senza stampa. Si risponde non-2xx e si avvisa.
  const res = await deliver({}, { printfulLookupStatuses: [500], expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.code, 'printful_order_lookup_retryable')
  assert.equal(printfulCreateRequests().length, 0, 'nessuna create senza aver verificato l esistenza')
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1)
  assert.equal(found[0].body.reason, 'fulfillment_failed')
  assert.equal(found[0].body.printfulStatus, 500)
  assert.deepEqual(found[0].body.skus, ['TS-A4'])
  assertNoPersonalData(found[0])
})

test('create 422 di validazione: 200 e code permanente, nessun retry atteso', async () => {
  // Un rifiuto di validazione viene ripetuto identico per tre giorni: il retry di
  // Stripe non aggiunge nulla, quindi la rotta avvisa e risponde 200.
  const res = await deliver({}, { createStatus: 422, expectedStatus: 200 })
  const body = await res.json()

  assert.equal(body.code, 'printful_create_permanent')
  assert.equal(body.printfulStatus, 422)
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, 422)
  // Nessuna verifica di esistenza: un rifiuto di validazione non crea nulla.
  assert.deepEqual(printfulLookups(), [ORDER_REF])
  assertNoPersonalData(found[0])
})

test('500 il cui corpo nomina external_id NON è un duplicato: 503 e avviso', async () => {
  // Regressione misurata in review: l'euristica legacy `/external_id/i` sul corpo
  // trasformava qualunque errore che citasse quel campo in "già creato" (200, zero
  // avvisi, zero retry). Un 5xx che parla di `external_id` nei dettagli non prova che
  // l'ordine esista: lo stato HTTP decide.
  const res = await deliver(
    {},
    {
      createStatus: 500,
      createBody: JSON.stringify({ error: { message: 'internal: external_id lookup failed' } }),
      expectedStatus: 503,
    },
  )
  const body = await res.json()

  assert.equal(body.code, 'printful_create_retryable')
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, 500)
  assertNoPersonalData(found[0])
})

test('422 che nomina external_id resta un rifiuto permanente, non un successo', async () => {
  // Stessa euristica, lato 4xx: "external_id is invalid" è un errore di validazione,
  // non un duplicato. Deve produrre l'avviso e il `code` permanente.
  const res = await deliver(
    {},
    {
      createStatus: 422,
      createBody: JSON.stringify({ error: { message: 'external_id is invalid: too long' } }),
      expectedStatus: 200,
    },
  )
  const body = await res.json()

  assert.equal(body.code, 'printful_create_permanent')
  assert.equal(fulfillmentAlerts().length, 1)
  assert.equal(fulfillmentAlerts()[0]!.body.reason, 'printful_create_failed')
})

test('create 409 (external_id già in uso): trattata come già evasa, nessun avviso', async () => {
  // Il segnale ESPLICITO di duplicato resta un successo: la corsa finita male tra
  // verifica e create non deve produrre un secondo pacco né un allarme.
  const res = await deliver(
    {},
    {
      createStatus: 409,
      createBody: JSON.stringify({ error: { message: 'Order with this external_id already exists' } }),
      expectedStatus: 200,
    },
  )
  const body = await res.json()

  assert.equal(body.received, true)
  assert.equal(alerts.length, 0, `nessun avviso atteso, ricevuti: ${JSON.stringify(alerts)}`)
  assert.equal(printfulCreateRequests().length, 1)
})

test('create 4xx con corpo che dichiara il duplicato: trattata come già evasa', async () => {
  // Il duplicato testuale si CONFERMA con la GET `external_id`: se l'ordine c'e', la
  // stampa e' gia' partita e non si avvisa.
  const res = await deliver(
    {},
    {
      createStatus: 400,
      createBody: JSON.stringify({ error: { message: 'This external_id is already used by another order' } }),
      // Prima della create l'ordine non c'è (404), poi la conferma lo trova (200):
      // il duplicato testuale è vero, la stampa è già partita.
      printfulLookupStatuses: [404, 200],
      expectedStatus: 200,
    },
  )
  const body = await res.json()

  assert.equal(body.received, true)
  assert.equal(alerts.length, 0)
  // Due lookup: quello di prima della create e quello di conferma.
  assert.deepEqual(printfulLookups(), [ORDER_REF, ORDER_REF])
})

test('conferma del duplicato non disponibile: resta l esito della create (status suo)', async () => {
  // Se la GET di conferma non risponde non si sa se l'ordine c'e'. Non si crea una
  // seconda volta e non si perde l'avviso, ma lo status riportato deve essere quello
  // del rifiuto di Printful (400), non quello della GET (500).
  const res = await deliver(
    {},
    {
      createStatus: 400,
      createBody: JSON.stringify({ error: { message: 'This external_id is already used by another order' } }),
      printfulLookupStatuses: [404, 500],
      expectedStatus: 200,
    },
  )
  const body = await res.json()

  assert.equal(body.code, 'printful_create_permanent')
  assert.equal(body.printfulStatus, 400)
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1)
  assert.equal(found[0].body.printfulStatus, 400)
  assert.equal(printfulCreateRequests().length, 1, 'la conferma fallita non deve produrre una seconda create')
})

test('4xx di validazione che usa la parola "duplicate" per altro: avviso, non successo', async () => {
  // Regressione della review round 2: "duplicate entries in items array" è un errore di
  // validazione, non un ordine già creato. Senza la conferma via `external_id` la rotta
  // tornava 200 in silenzio (ordine pagato, non stampato, nessun avviso). Con la conferma
  // l'ordine non esiste → resta un rifiuto permanente, con l'avviso.
  const res = await deliver(
    {},
    {
      createStatus: 400,
      createBody: JSON.stringify({ error: { message: 'Validation failed: duplicate entries in items array' } }),
      expectedStatus: 200,
    },
  )
  const body = await res.json()

  assert.equal(body.code, 'printful_create_permanent')
  assert.equal(body.printfulStatus, 400)
  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.equal(found[0].body.reason, 'printful_create_failed')
  assert.equal(found[0].body.printfulStatus, 400)
  assertNoPersonalData(found[0])
})

test('destinatario senza nome: l avviso dice che manca il nome', async () => {
  // Printful richiede `recipient.name`; la create lo manda. Con tutti i campi
  // dell'indirizzo ma senza nome, il rifiuto deve portare il campo mancante.
  await deliver(
    {
      collected: {
        shipping_details: { address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' } },
      },
      metadata: { customer_name: '' },
    },
    { createStatus: 422 },
  )

  const found = fulfillmentAlerts()
  assert.equal(found.length, 1, `atteso un avviso, ricevuti ${alerts.length}: ${JSON.stringify(alerts)}`)
  assert.deepEqual(found[0].body.missingFields, ['name'])
  assert.equal(found[0].body.printfulStatus, 422)
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

function printfulCreateRequest(): Captured | undefined {
  return captured.find((c) => c.url === PRINTFUL_CREATE_URL && c.method === 'POST')
}

function printfulCreateRequests(): Captured[] {
  return captured.filter((c) => c.url === PRINTFUL_CREATE_URL && c.method === 'POST')
}

function printfulLookups(): string[] {
  return captured
    .filter((c) => c.url.startsWith(`${PRINTFUL_CREATE_URL}/@`))
    .map((c) => decodeURIComponent(c.url.slice(`${PRINTFUL_CREATE_URL}/@`.length)))
}

test('sessione senza order_ref con ordine CMS esistente: usa il numero dell ordine, non l id di sessione', async () => {
  await deliver(
    { omitOrderRef: true },
    { cmsOrders: [{ orderNumber: CMS_ORDER_NUMBER, stripeSessionId: 'cs_test_printful_1' }] },
  )

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
  const res = await deliver({ omitOrderRef: true }, { cmsOrders: [], expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.error, 'order_reference_unresolved')
  assert.equal(body.code, 'order_ref_unresolved')
  assert.equal(printfulCreateRequest(), undefined, 'nessun ordine di stampa senza un riferimento risolto')
  // L'unica chiamata a Printful e' la ricerca del riferimento legacy: nessuna create.
  assert.deepEqual(printfulLookups(), ['FOOLISH-cs_test_printful_1'])
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]!.path, '/hooks/foolish-printful-fulfillment')
  assert.equal(alerts[0]!.body.eventType, 'printful_fulfillment_alert')
  assert.equal(alerts[0]!.body.reason, 'order_ref_unresolved')
  assert.equal(alerts[0]!.body.stripeSessionId, 'cs_test_printful_1')
  assert.equal(alerts[0]!.body.legacyPrintfulOrderExists, false)
})

test('legacy: un pacco gia creato con FOOLISH-<session.id> viene ritrovato, non duplicato', async () => {
  const res = await deliver(
    { omitOrderRef: true },
    { cmsOrders: [], printfulExistingRefs: ['FOOLISH-cs_test_printful_1'] },
  )
  const body = await res.json()

  assert.equal(res.status, 200)
  assert.equal(body.legacyOrderRef, 'FOOLISH-cs_test_printful_1')
  assert.equal(printfulCreateRequest(), undefined, 'nessun secondo ordine di stampa')
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]!.body.legacyPrintfulOrderExists, true)
  assert.equal(alerts[0]!.body.orderRef, 'FOOLISH-cs_test_printful_1')
})

test('ordine CMS legacy senza stripeSessionId: ritrovato per numero, stessa chiave di stampa', async () => {
  await deliver({ omitOrderRef: true }, { cmsOrders: [{ orderNumber: 'FOOLISH-cs_test_printful_1' }] })

  const create = printfulCreateRequest()
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.equal(create.body?.external_id, 'FOOLISH-cs_test_printful_1')
  // Il numero arriva dalla lettura del CMS, non da una stringa costruita a mano.
  assert.ok(captured.some((c) => c.url.includes('where[orderNumber][equals]=FOOLISH-cs_test_printful_1')))
})

test('order_ref dichiarato: nessuna ricerca sul CMS, la POST usa il numero dichiarato', async () => {
  await deliver({}, { cmsOrders: [{ orderNumber: 'altro-ordine' }] })

  const create = printfulCreateRequest()
  assert.ok(create, "nessuna POST a Printful: l'ordine di stampa non e' stato creato")
  assert.equal(create.body?.external_id, ORDER_REF)
  assert.equal(captured.filter((c) => c.url.startsWith('https://cms.test/api/orders')).length, 0)
})

test('CMS non disponibile durante la risoluzione: 503 e nessun ordine di stampa', async () => {
  const res = await deliver({ omitOrderRef: true }, { cmsOrdersFailure: 500, expectedStatus: 503 })
  const body = await res.json()

  assert.equal(body.error, 'order_reference_lookup_failed')
  assert.equal(printfulCreateRequest(), undefined)
})

test('ordine con order_ref ma senza righe merch: 200, nessuna create, nessun avviso', async () => {
  // Comportamento attuale da non rompere: un ordine senza merce da stampare non deve
  // produrre un ordine Printful (e quindi non deve nemmeno allertare). Qui `order_ref`
  // c'e': il ritorno anticipato e' per le righe, non per il riferimento.
  await deliver({ metadata: { items_json: '[]', order_ref: ORDER_REF } })

  assert.equal(alerts.length, 0)
  assert.equal(printfulCreateRequests().length, 0)
  assert.equal(printfulLookups().length, 0)
})

test('sessione senza order_ref e senza righe merch: nessun allarme, 200', async () => {
  await deliver({ omitOrderRef: true, metadata: { items_json: '[]' } })

  assert.equal(alerts.length, 0)
  assert.equal(printfulLookups().length, 0)
})

test('ordine CMS legacy e pacco legacy entrambi presenti: nessun secondo pacco', async () => {
  await deliver(
    { omitOrderRef: true },
    {
      cmsOrders: [{ orderNumber: 'FOOLISH-cs_test_printful_1' }],
      printfulExistingRefs: ['FOOLISH-cs_test_printful_1'],
    },
  )

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
