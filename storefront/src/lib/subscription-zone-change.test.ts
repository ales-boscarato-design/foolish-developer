/**
 * Test del cambio di zona di un abbonamento.
 *
 * Perche' esiste: il cambio di zona cambia la tariffa che il cliente paga a ogni
 * ciclo, e la destinazione reale dell'abbonamento non e' nel documento CMS (sta
 * su Stripe, sulla fattura o sul cliente). Prima di questa copertura il percorso
 * non aveva alcun test, e un abbonato con indirizzo svizzero poteva passare alla
 * scala `EU` pagando 14,99 EUR di spedizione a ciclo contro un costo sdoganato
 * misurato di 48,00 EUR su un carrello da 45,00 e 52,49 EUR su uno da 99,00.
 *
 * Il finto client Stripe e lo stub di `fetch` (solo CMS) tengono il test
 * ermetico: nessuna rete, nessuna credenziale. Ogni caso verifica anche che cosa
 * NON e' stato scritto, perche' qui l'errore costoso e' una scrittura di troppo.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import type Stripe from 'stripe'

import { calculateShipping } from './shipping'
import {
  getBenefitForCycle,
  isActivatableDestination,
  isZoneChangeAllowed,
  type Zone,
} from './subscription-plans'
import {
  changeSubscriptionZone,
  resolveSubscriptionDestination,
  type ZoneChangeRequest,
} from './subscription-zone-change'

const CMS_URL = 'https://cms.test'
const SESSION_EMAIL = 'cliente@example.com'
const STOREFRONT_SECRET = 'test-storefront-secret'

interface FetchCall {
  url: string
  method: string
  body: string | null
  secret: string | null
}

const fetchCalls: FetchCall[] = []
let cmsDoc: Record<string, unknown> | null = null
let patchStatus = 200

const realFetch = globalThis.fetch

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
  const method = (init?.method ?? 'GET').toUpperCase()
  const headers = (init?.headers ?? {}) as Record<string, string>
  fetchCalls.push({
    url,
    method,
    body: typeof init?.body === 'string' ? init.body : null,
    secret: headers['x-storefront-secret'] ?? null,
  })

  if (!url.startsWith(`${CMS_URL}/api/subscriptions/`)) throw new Error(`fetch non previsto nel test: ${url}`)
  if (method === 'PATCH') {
    return new Response(JSON.stringify({ doc: {} }), { status: patchStatus })
  }
  if (!cmsDoc) return new Response(JSON.stringify({ errors: [{ message: 'Not Found' }] }), { status: 404 })
  return new Response(JSON.stringify(cmsDoc), { status: 200 })
}) as typeof fetch

test.after(() => {
  globalThis.fetch = realFetch
})

test.beforeEach(() => {
  fetchCalls.length = 0
  cmsDoc = subscriptionDoc()
  patchStatus = 200
})

interface StripeScenario {
  /** `customer_shipping.address.country` di ogni fattura, in ordine (null = fattura senza indirizzo). */
  invoiceCountries?: (string | null)[]
  /** `created` di ogni fattura: l'ordine della lista non va dato per scontato. */
  invoiceCreated?: number[]
  invoicesError?: boolean
  customerCountry?: string | null
  customerError?: boolean
  customerDeleted?: boolean
  subscriptionsRetrieveError?: boolean
  scheduleError?: boolean
}

function fakeStripe(scenario: StripeScenario = {}) {
  const calls = {
    invoicesList: 0,
    subscriptionsRetrieve: 0,
    customersRetrieve: 0,
    scheduleRetrieve: 0,
    scheduleUpdate: 0,
  }
  const schedulePhases: unknown[][] = []

  const stripe = {
    invoices: {
      list: async () => {
        calls.invoicesList += 1
        if (scenario.invoicesError) throw new Error('stripe non raggiungibile')
        const countries = scenario.invoiceCountries ?? []
        return {
          data: countries.map((country, index) => ({
            id: `in_test_${index}`,
            created: scenario.invoiceCreated?.[index] ?? 1_700_000_000 - index,
            customer_shipping: country ? { name: 'Cliente Test', address: { country } } : null,
          })),
        }
      },
    },
    subscriptions: {
      retrieve: async (id: string) => {
        calls.subscriptionsRetrieve += 1
        if (scenario.subscriptionsRetrieveError) throw new Error('stripe non raggiungibile')
        return { id, customer: 'cus_test' }
      },
    },
    customers: {
      retrieve: async (id: string) => {
        calls.customersRetrieve += 1
        if (scenario.customerError) throw new Error('stripe non raggiungibile')
        if (scenario.customerDeleted) return { id, object: 'customer', deleted: true }
        return {
          id,
          object: 'customer',
          shipping: scenario.customerCountry ? { name: 'Cliente Test', address: { country: scenario.customerCountry } } : null,
        }
      },
    },
    subscriptionSchedules: {
      retrieve: async (id: string) => {
        calls.scheduleRetrieve += 1
        return { id, status: 'active', current_phase: { start_date: 1_700_000_000 } }
      },
      update: async (id: string, params: { phases: unknown[] }) => {
        calls.scheduleUpdate += 1
        if (scenario.scheduleError) throw new Error('stripe non raggiungibile')
        schedulePhases.push(params.phases)
        return { id, phases: params.phases }
      },
    },
    products: {
      search: async () => ({ data: [{ id: 'prod_test' }] }),
    },
  }

  return { stripe: stripe as unknown as Stripe, calls, schedulePhases }
}

function subscriptionDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub_doc_1',
    customerEmail: SESSION_EMAIL,
    plan: 'tattoo',
    zone: 'IT',
    stripeSubscriptionId: 'sub_stripe_1',
    stripeScheduleId: 'sub_sched_1',
    cyclesCompleted: 0,
    ...overrides,
  }
}

function setup(scenario: StripeScenario = {}) {
  const { stripe, calls, schedulePhases } = fakeStripe(scenario)
  return {
    stripe,
    calls,
    schedulePhases,
    call: (overrides: Partial<ZoneChangeRequest> = {}) =>
      changeSubscriptionZone(
        { stripe, cmsUrl: CMS_URL, cmsSecret: STOREFRONT_SECRET },
        {
          subscriptionDocId: 'sub_doc_1',
          newZone: 'EU',
          sessionEmail: SESSION_EMAIL,
          ...overrides,
        },
      ),
    patches: () => fetchCalls.filter((call) => call.method === 'PATCH'),
  }
}

function firstPhaseAmount(phases: unknown[]): number {
  const phase = phases[0] as { items: { price_data: { unit_amount: number } }[] }
  return phase.items[0].price_data.unit_amount
}

test("destinazione svizzera: il cambio zona verso EU e' respinto e non scrive niente", async () => {
  // Il numero che giustifica il blocco (misurato il 21/09/2026): la scala EU
  // addebita 14,99 di spedizione a ciclo, la destinazione svizzera costa 48,00
  // su un carrello da 45,00 e 52,49 su uno da 99,00.
  assert.equal(getBenefitForCycle('tattoo', 'EU', 1).shippingPrice, 14.99)
  assert.ok(calculateShipping(45, 'CH').cost > 14.99)
  assert.ok(calculateShipping(99, 'CH').cost > 14.99)

  const { call, calls, patches } = setup({ invoiceCountries: ['CH'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(result.body.ok, undefined)
  assert.equal(calls.invoicesList, 1)
  assert.equal(calls.scheduleUpdate, 0, 'nessuna fase Stripe ricostruita')
  assert.equal(patches().length, 0, 'nessun PATCH sul documento CMS')
  assert.equal(JSON.stringify(result.body).includes('sub_stripe_1'), false)
})

test('destinazione svizzera: il cambio e\' respinto anche nella direzione opposta', async () => {
  cmsDoc = subscriptionDoc({ zone: 'EU' })
  const { call, calls, patches } = setup({ invoiceCountries: [null], customerCountry: 'CH' })
  const result = await call({ newZone: 'IT' })

  assert.equal(result.status, 409)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('destinazione italiana: la scala IT resta quella giusta, il passaggio a EU e\' respinto', async () => {
  // Decisione esplicita (Alessandro, 21/09/2026: "la tariffa segue il destino"):
  // la zona di arrivo deve essere la zona REALE della destinazione, quindi un
  // indirizzo italiano non sale sulla scala EU (e un indirizzo UE non scende
  // sulla scala IT, dove la spedizione e' gratis: sarebbe lo stesso buco al
  // contrario). Restringere a "solo l'extra-UE" e' una riga di policy, non una
  // riga di soldi: se Alessandro preferisce l'italiano sulla scala EU si cambia
  // li', non qui.
  const { call, calls, patches } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
  assert.equal(getBenefitForCycle('tattoo', 'IT', 1).shippingPrice, 7.65)
})

test('destinazione italiana, stessa zona: nessuna modifica e nessun PATCH', async () => {
  const { call, calls, patches } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'IT' })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(calls.invoicesList, 0)
  assert.equal(patches().length, 0)
})

test('destinazione UE (DE), cambio IT -> EU: e\' ammesso, con le fasi della scala EU', async () => {
  // Il caso che deve continuare a funzionare: destinazione UE, zona di arrivo UE.
  const { call, calls, schedulePhases, patches } = setup({ invoiceCountries: ['DE'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(calls.scheduleUpdate, 1)
  assert.equal(patches().length, 1)
  assert.equal(patches()[0].body, JSON.stringify({ zone: 'EU' }))
  assert.equal(patches()[0].secret, STOREFRONT_SECRET)
  assert.equal(calls.customersRetrieve, 0, 'quando la fattura risponde non si legge il cliente')

  // cyclesCompleted 0 -> prossimo ciclo 1 -> prima fase della scala EU (45 + 14,99).
  assert.equal(schedulePhases[0].length, 3)
  assert.equal(firstPhaseAmount(schedulePhases[0]), 5999)
  assert.equal(
    (schedulePhases[0][0] as { start_date: number }).start_date,
    1_700_000_000,
    'la fase in corso mantiene il suo start_date',
  )
})

test("destinazione UE (DE): la scala IT non e' disponibile", async () => {
  cmsDoc = subscriptionDoc({ zone: 'EU' })
  const { call, calls, patches } = setup({ invoiceCountries: ['DE'] })
  const result = await call({ newZone: 'IT' })

  assert.equal(result.status, 409)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('fattura senza indirizzo: si ripiega sull indirizzo di spedizione del cliente', async () => {
  const { call, calls, patches } = setup({ invoiceCountries: [null], customerCountry: 'CH' })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.customersRetrieve, 1)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('si guarda solo la fattura piu recente: un paese vecchio non autorizza il cambio', async () => {
  // La fattura piu' recente (created 2000) non porta indirizzo; una piu' vecchia
  // (created 1000) porta la Germania. Un paese trovato all'indietro nella storia
  // non e' una prova di dove si spedisce adesso: si ripiega sul cliente, e se
  // nemmeno li' c'e' un paese il cambio resta rifiutato.
  const { call, calls, patches } = setup({
    invoiceCountries: [null, 'DE'],
    invoiceCreated: [2000, 1000],
    customerCountry: null,
  })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.customersRetrieve, 1)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test("l'ordine della lista fatture non si assume: conta la piu' recente per created", async () => {
  // In lista la svizzera viene per prima, ma la piu' recente per `created` e' la
  // tedesca: se il codice si fidasse dell'ordine della lista rifiuterebbe un
  // cambio legittimo (destinazione UE).
  const { call, patches } = setup({
    invoiceCountries: ['CH', 'DE'],
    invoiceCreated: [1000, 2000],
  })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 200)
  assert.equal(patches().length, 1)
})

test('destinazione non determinabile: il cambio non si autorizza (fail-closed)', async () => {
  const { call, calls, patches } = setup({ invoiceCountries: [null], customerCountry: null })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('cliente cancellato su Stripe: nessun paese, cambio respinto', async () => {
  const { call, calls, patches } = setup({ invoiceCountries: [], customerDeleted: true })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('Stripe non risponde: 503 e nessuna scrittura', async () => {
  const { call, calls, patches } = setup({ invoicesError: true, customerError: true })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 503)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(patches().length, 0)
})

test('un solo lookup rotto non basta a decidere: la destinazione viene dal cliente', async () => {
  const { call, patches } = setup({ invoicesError: true, customerCountry: 'CH' })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(patches().length, 0)
})

test('abbonamento di un altro cliente: 403 e nessuna chiamata a Stripe', async () => {
  const { call, calls } = setup({ invoiceCountries: ['CH'] })
  const result = await call({ sessionEmail: 'intruso@example.com' })

  assert.equal(result.status, 403)
  assert.deepEqual(calls, {
    invoicesList: 0,
    subscriptionsRetrieve: 0,
    customersRetrieve: 0,
    scheduleRetrieve: 0,
    scheduleUpdate: 0,
  })
})

test('email assente da un lato solo: 403, non un via libera', async () => {
  // "entrambe vuote" non vuol dire "uguali, quindi autorizzato": un documento
  // senza intestatario non si modifica da una sessione senza email.
  const session = setup({ invoiceCountries: ['CH'] })

  cmsDoc = subscriptionDoc({ customerEmail: '' })
  const docWithoutEmail = await session.call({ sessionEmail: '' })
  assert.equal(docWithoutEmail.status, 403)

  cmsDoc = subscriptionDoc()
  const sessionWithoutEmail = await session.call({ sessionEmail: '' })
  assert.equal(sessionWithoutEmail.status, 403)

  assert.equal(session.calls.invoicesList, 0)
  assert.equal(session.calls.scheduleUpdate, 0)
})

test('parametri non validi: 400 senza toccare Stripe ne il CMS', async () => {
  const { call, calls } = setup({ invoiceCountries: ['CH'] })

  for (const bad of [{ newZone: 'XX' }, { newZone: undefined }, { subscriptionDocId: '' }, { subscriptionDocId: 42 }]) {
    const result = await call(bad as Partial<ZoneChangeRequest>)
    assert.equal(result.status, 400, JSON.stringify(bad))
  }

  assert.equal(fetchCalls.length, 0)
  assert.equal(calls.invoicesList, 0)
})

test('stessa zona: nessuna modifica, nessuna chiamata a Stripe, nessun PATCH', async () => {
  cmsDoc = subscriptionDoc({ zone: 'EU' })
  const { call, calls } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 200)
  assert.equal(result.body.ok, true)
  assert.equal(calls.invoicesList, 0)
  assert.equal(calls.scheduleUpdate, 0)
  assert.equal(fetchCalls.filter((call2) => call2.method === 'PATCH').length, 0)
})

test('documento assente: 404', async () => {
  cmsDoc = null
  const { call, calls } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 404)
  assert.equal(calls.invoicesList, 0)
})

test('abbonamento senza schedule Stripe: 400 prima di qualunque verifica', async () => {
  cmsDoc = subscriptionDoc({ stripeScheduleId: null })
  const { call, calls, patches } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 400)
  assert.equal(calls.invoicesList, 0)
  assert.equal(patches().length, 0)
})

test('documento senza subscription Stripe: 409, nessuna scrittura', async () => {
  cmsDoc = subscriptionDoc({ stripeSubscriptionId: null })
  const { call, calls, patches } = setup({ invoiceCountries: ['IT'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 409)
  assert.equal(calls.invoicesList, 0)
  assert.equal(patches().length, 0)
})

test('Stripe in errore durante la ricostruzione delle fasi: 502, zona invariata', async () => {
  const { call, patches } = setup({ invoiceCountries: ['DE'], scheduleError: true })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 502)
  assert.equal(patches().length, 0)
})

test('il CMS non accetta l aggiornamento: 500', async () => {
  patchStatus = 500
  const { call } = setup({ invoiceCountries: ['DE'] })
  const result = await call({ newZone: 'EU' })

  assert.equal(result.status, 500)
  assert.equal(result.body.error, 'Errore aggiornamento abbonamento')
})

test('la destinazione ammessa resta una sola fonte: la policy coincide con le attivazioni', async () => {
  const countries = ['IT', 'DE', 'FR', 'ES', 'CH', 'NO', 'IS', 'LI', 'GB', 'US', 'CA', 'AU', 'JP', 'ZZ', '', 'ch']
  const zones: Zone[] = ['IT', 'EU']

  for (const country of countries) {
    for (const zone of zones) {
      assert.equal(
        isZoneChangeAllowed(zone, country),
        isActivatableDestination(zone, country),
        `${zone} / ${country}`,
      )
    }
  }

  // Nessun cambio di zona per le destinazioni extra-UE, in entrambe le direzioni.
  for (const country of ['CH', 'NO', 'IS', 'LI', 'GB', 'US', 'ZZ']) {
    assert.equal(isZoneChangeAllowed('IT', country), false, country)
    assert.equal(isZoneChangeAllowed('EU', country), false, country)
  }
  assert.equal(isZoneChangeAllowed('EU', null), false)
  assert.equal(isZoneChangeAllowed('EU', undefined), false)
})

test('resolveSubscriptionDestination: fattura prima, cliente come ripiego', async () => {
  const withInvoice = fakeStripe({ invoiceCountries: ['CH'], customerCountry: 'DE' })
  assert.deepEqual(await resolveSubscriptionDestination(withInvoice.stripe, 'sub_stripe_1'), {
    country: 'CH',
    source: 'invoice',
    lookupFailed: false,
  })

  const fromCustomer = fakeStripe({ invoiceCountries: [], customerCountry: 'de' })
  assert.deepEqual(await resolveSubscriptionDestination(fromCustomer.stripe, 'sub_stripe_1'), {
    country: 'DE',
    source: 'customer',
    lookupFailed: false,
  })

  const nothing = fakeStripe({ invoiceCountries: [], customerCountry: null })
  assert.deepEqual(await resolveSubscriptionDestination(nothing.stripe, 'sub_stripe_1'), {
    country: null,
    source: null,
    lookupFailed: false,
  })

  const down = fakeStripe({ invoicesError: true, customerError: true })
  assert.deepEqual(await resolveSubscriptionDestination(down.stripe, 'sub_stripe_1'), {
    country: null,
    source: null,
    lookupFailed: true,
  })
})
