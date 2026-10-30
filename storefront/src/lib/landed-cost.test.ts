/**
 * Test della catena di prezzo extra-UE (quota live + tabella in casa + profilo).
 *
 * I numeri usati qui vengono dalle quote REALI misurate il 21/09/2026 su
 * `POST /landed-cost/v1/quote` (fatture TFC-WEB-000xx), non da stime di comodo.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_QUOTE_ITEMS,
  cartFingerprint,
  fetchLandedCostQuote,
  isPackSku,
  loadLandedCostTable,
  normalizeQuoteItems,
  parseQuoteResponse,
  profileCostCents,
  quoteImportChargesImplausible,
  resolveExtraEuShipping,
  signQuoteToken,
  tableCostCents,
  verifyQuoteToken,
} from './landed-cost'
import { EXTRA_EU_MINIMUM_SHIPPING, calculateShipping } from './shipping'
import { prudentialExtraEuPriceCents } from './landed-cost-price'
import landedCostTable from './landed-cost-table.json'

const TOKEN_SECRET = 'test-only-token-secret'
process.env.SHIPPING_QUOTE_TOKEN_SECRET = TOKEN_SECRET

const QUOTE_CONFIG = { url: 'https://quote.test/landed-cost/v1/quote', secret: 'test-shared-secret', enabled: true }

/**
 * Risposta del servizio di quota con la forma REALE (CH, Basel, merce 99),
 * misurata il 21/09/2026 dopo la correzione della copertura assicurata
 * (`goods_plus_shipping`): la stima dichiarata COINCIDE con la quota della
 * copertura approvata (47,29) e il blocco `insurance_coverage` dice su quale
 * base e' stato calcolato il premio (142,72 = 99,00 + 43,72, premio 3,57).
 */
function quoteResponse(serviceOverrides: Record<string, unknown> = {}, bodyOverrides: Record<string, unknown> = {}) {
  return {
    status: 'ok',
    goods_value: 99,
    parcel: { weight: 2, width: 40, height: 10, length: 40, packages: 1 },
    services: [
      {
        service_id: 22131,
        carrier: 'UPS',
        service_name: 'Standard Access Point',
        transport: 23,
        insurance: 3.57,
        import_charges: 14.77,
        ddp_fee: 4.96,
        shipping_and_import: 47.29,
        landed_cost_estimate: 47.29,
        insurance_coverage: {
          policy: 'goods_plus_shipping',
          base: 142.72,
          base_source: 'goods_value_plus_shipping_cost',
          declared_goods_value: 99,
          shipping_cost_excluding_premium: 43.72,
          rate: 0.025,
          premium: 3.57,
          premium_quoted: 3.57,
          premium_agrees: true,
          minimum_premium: 0.99,
        },
        checkout_invoice_number: 'TFC-WEB-00011',
        expires_at: 1_800_000_000,
        ...serviceOverrides,
      },
    ],
    ...bodyOverrides,
  }
}

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  return (async (url: string, init?: RequestInit) => {
    const result = handler(String(url), init)
    if (result instanceof Error) throw result
    return {
      ok: true,
      status: 200,
      json: async () => result,
    } as unknown as Response
  }) as unknown as typeof fetch
}

function httpError(status: number) {
  return {
    ok: false,
    status,
    json: async () => ({}),
  } as unknown as Response
}

test('parseQuoteResponse legge una quota reale in centesimi', () => {
  const quote = parseQuoteResponse(quoteResponse())
  assert.ok(quote)
  // CH Basel merce 99, copertura approvata: la quota e la stima dichiarata sono
  // lo stesso numero (47,29), il +1,52 non esiste piu'.
  assert.equal(quote.shippingAndImportCents, 4729)
  assert.equal(quote.landedCostCents, 4729)
  assert.equal(quote.transportCents, 2300)
  assert.equal(quote.importChargesCents, 1477)
  assert.equal(quote.checkoutInvoiceNumber, 'TFC-WEB-00011')
  assert.equal(quote.serviceId, 22131)
  assert.deepEqual(quote.parcel, { weightKg: 2, widthCm: 40, heightCm: 10, lengthCm: 40, packages: 1 })
})

test('parseQuoteResponse scarta le quote senza dazi, senza fee DDP o senza forma', () => {
  assert.equal(parseQuoteResponse(null), null)
  assert.equal(parseQuoteResponse({ status: 'ok', services: [] }), null)
  assert.equal(parseQuoteResponse(quoteResponse({}, { status: 'error' })), null)
  // trappola misurata: 200 con dazi a 0,00 quando manca la fattura doganale
  assert.equal(parseQuoteResponse(quoteResponse({ import_charges: 0 })), null)
  assert.equal(parseQuoteResponse(quoteResponse({ ddp_fee: 0 })), null)
  assert.equal(parseQuoteResponse(quoteResponse({ shipping_and_import: '46.20' })), null)
  // landed_cost_estimate sotto shipping_and_import non e' una quota coerente
  assert.equal(parseQuoteResponse(quoteResponse({ landed_cost_estimate: 40 })), null)
})

test('parseQuoteResponse prende il servizio DDP piu economico', () => {
  const body = quoteResponse()
  body.services.push({
    ...body.services[0]!,
    service_id: 999,
    shipping_and_import: 41.5,
    landed_cost_estimate: 41.5,
    insurance_coverage: {
      policy: 'goods_plus_shipping',
      base: 137.07,
      base_source: 'goods_value_plus_shipping_cost',
      declared_goods_value: 99,
      shipping_cost_excluding_premium: 134.07,
      rate: 0.025,
      premium: 3.43,
      premium_quoted: 3.43,
      premium_agrees: true,
      minimum_premium: 0.99,
    },
  })
  const quote = parseQuoteResponse(body)
  assert.ok(quote)
  assert.equal(quote.serviceId, 999)
  assert.equal(quote.shippingAndImportCents, 4150)
})

test('la tabella in casa ha le bande reali e scarta le voci malformate', () => {
  const bands = loadLandedCostTable()
  assert.ok(bands.get('CH')?.length)
  assert.ok(bands.get('GB')?.length)
  assert.equal(bands.get('AU'), undefined)

  const malformed = loadLandedCostTable({
    countries: {
      CH: { bands: [{ goods_value_cents: 0, cost_basis_cents: 4772, shipping_and_import_cents: 4620 }] },
      GB: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 'x', shipping_and_import_cents: 4620 }] },
      zzz: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 4772, shipping_and_import_cents: 4620 }] },
      NO: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 7384, shipping_and_import_cents: 7232 }] },
    },
  })
  assert.equal(malformed.get('CH'), undefined)
  assert.equal(malformed.get('GB'), undefined)
  assert.equal(malformed.get('ZZZ'), undefined)
  assert.equal(malformed.get('NO')?.length, 1)
})

test('tableCostCents prende la banda piu piccola che copre il carrello', () => {
  // Valori della tabella rigenerata dal servizio il 21/09/2026 (CH 47,29 = la
  // quota della copertura approvata, non piu' 47,72).
  assert.equal(tableCostCents('ch', 1000), 4729)
  assert.equal(tableCostCents('CH', 9900), 4729)
  // sopra l'ultima banda resta l'ultima misura: e' un pavimento, non una stima
  assert.equal(tableCostCents('CH', 500_000), 4729)
  assert.equal(tableCostCents('GB', 1000), 3899)
  assert.equal(tableCostCents('GB', 9900), 6035)
  assert.equal(tableCostCents('AU', 9900), null)
  assert.equal(tableCostCents('ZZ', 9900), null)
})

test('cartFingerprint lega il prezzo al carrello', () => {
  const a = cartFingerprint([{ sku: 'TS-A4', quantity: 1 }], 'CH')
  const b = cartFingerprint([{ sku: 'ts-a4', quantity: 1 }], 'ch')
  assert.equal(a, b)
  assert.equal(cartFingerprint([{ sku: 'TS-A4', quantity: 1 }, { sku: 'X', quantity: 2 }], 'CH'), cartFingerprint([{ sku: 'X', quantity: 2 }, { sku: 'TS-A4', quantity: 1 }], 'CH'))
  assert.notEqual(a, cartFingerprint([{ sku: 'TS-A4', quantity: 2 }], 'CH'))
  assert.notEqual(a, cartFingerprint([{ sku: 'TS-A4', quantity: 1 }], 'GB'))
})

test('gettone del prezzo: firma, verifica, scadenza e manomissione', () => {
  const fingerprint = cartFingerprint([{ sku: 'TS-A4', quantity: 1 }], 'CH')
  const now = new Date('2026-09-21T15:00:00Z')
  const token = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5202, now })
  assert.ok(token)
  assert.equal(verifyQuoteToken(token, { countryCode: 'ch', fingerprint, now }), 5202)
  // paese diverso, carrello diverso, gettone manomesso: tutti rifiutati
  assert.equal(verifyQuoteToken(token, { countryCode: 'GB', fingerprint, now }), null)
  assert.equal(verifyQuoteToken(token, { countryCode: 'CH', fingerprint: 'altro', now }), null)
  assert.equal(verifyQuoteToken(token.replace(/.$/, 'A'), { countryCode: 'CH', fingerprint, now }), null)
  assert.equal(verifyQuoteToken('non-un-gettone', { countryCode: 'CH', fingerprint, now }), null)
  assert.equal(verifyQuoteToken(undefined, { countryCode: 'CH', fingerprint, now }), null)
  // scaduto
  const later = new Date('2026-09-21T16:00:00Z')
  assert.equal(verifyQuoteToken(token, { countryCode: 'CH', fingerprint, now: later }), null)

  const previous = process.env.SHIPPING_QUOTE_TOKEN_SECRET
  delete process.env.SHIPPING_QUOTE_TOKEN_SECRET
  assert.equal(signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5202, now }), null)
  assert.equal(verifyQuoteToken(token, { countryCode: 'CH', fingerprint, now }), null)
  process.env.SHIPPING_QUOTE_TOKEN_SECRET = previous
})

test('guardia sugli oneri import: una quota a un pezzo passa, una gonfiata dalla quantita no', () => {
  const single = parseQuoteResponse(quoteResponse())
  assert.ok(single)
  assert.equal(quoteImportChargesImplausible(single, { countryCode: 'CH', totalQuantity: 1 }), false)

  // MISURATO: US, TS-A5 x4 (merce 50), trasporto 42,75, oneri import 25,45:
  // aliquota implicita 27,4% contro il 15% di legge. E' il difetto misurato.
  const inflated = parseQuoteResponse(
    quoteResponse(
      {
        transport: 42.75,
        import_charges: 25.45,
        ddp_fee: 10.71,
        shipping_and_import: 84.9,
        landed_cost_estimate: 86.42,
      },
      { goods_value: 50 },
    ),
  )
  assert.ok(inflated)
  assert.equal(quoteImportChargesImplausible(inflated, { countryCode: 'US', totalQuantity: 4 }), true)
  // lo stesso importo su un carrello a un pezzo non e' giudicabile come gonfiato
  assert.equal(quoteImportChargesImplausible(inflated, { countryCode: 'US', totalQuantity: 1 }), false)

  // ceil assoluto: nessuna destinazione ammessa ha dazi+IVA oltre il 60%
  const absurd = parseQuoteResponse(
    quoteResponse({ import_charges: 400, shipping_and_import: 423.2, landed_cost_estimate: 424.72 }),
  )
  assert.ok(absurd)
  assert.equal(quoteImportChargesImplausible(absurd, { countryCode: 'CH', totalQuantity: 1 }), true)
})

test('fetchLandedCostQuote: nessun segreto, errori di rete e risposta invalida sono motivi, non eccezioni', async () => {
  const disabled = await fetchLandedCostQuote({
    cartId: 'x',
    countryCode: 'CH',
    destination: {},
    items: [{ sku: 'TS-A4', quantity: 1 }],
    config: { ...QUOTE_CONFIG, enabled: false },
  })
  assert.deepEqual(disabled, { ok: false, reason: 'disabled' })

  const http = await fetchLandedCostQuote({
    cartId: 'x',
    countryCode: 'CH',
    destination: {},
    items: [{ sku: 'TS-A4', quantity: 1 }],
    config: QUOTE_CONFIG,
    fetchImpl: (async () => httpError(503)) as unknown as typeof fetch,
  })
  assert.deepEqual(http, { ok: false, reason: 'http_503' })

  const timeout = await fetchLandedCostQuote({
    cartId: 'x',
    countryCode: 'CH',
    destination: {},
    items: [{ sku: 'TS-A4', quantity: 1 }],
    config: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => {
      const error = new Error('timeout')
      error.name = 'TimeoutError'
      return error
    }),
  })
  assert.deepEqual(timeout, { ok: false, reason: 'timeout' })

  const invalid = await fetchLandedCostQuote({
    cartId: 'x',
    countryCode: 'CH',
    destination: {},
    items: [{ sku: 'TS-A4', quantity: 1 }],
    config: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => ({ status: 'ok', services: [] })),
  })
  assert.deepEqual(invalid, { ok: false, reason: 'response_invalid' })

  const ok = await fetchLandedCostQuote({
    cartId: 'x',
    countryCode: 'CH',
    destination: {},
    items: [{ sku: 'TS-A4', quantity: 1 }],
    config: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => quoteResponse()),
  })
  assert.equal(ok.ok, true)
})

test('normalizeQuoteItems accetta solo righe quotabili', () => {
  assert.deepEqual(normalizeQuoteItems([{ sku: 'TS-A4', quantity: 1 }]), [{ sku: 'TS-A4', quantity: 1 }])
  assert.equal(normalizeQuoteItems([]), null)
  assert.equal(normalizeQuoteItems([{ sku: '', quantity: 1 }]), null)
  assert.equal(normalizeQuoteItems([{ sku: 'TS-A4', quantity: 0 }]), null)
  assert.equal(normalizeQuoteItems([{ sku: 'TS-A4', quantity: 1.5 }]), null)
  assert.equal(normalizeQuoteItems([{ sku: 'TS-A4', quantity: 51 }]), null)
  assert.equal(
    normalizeQuoteItems(Array.from({ length: MAX_QUOTE_ITEMS + 1 }, () => ({ sku: 'TS-A4', quantity: 1 }))),
    null,
  )
})

test('resolveExtraEuShipping: fuori dall extra-UE non risolve nulla', async () => {
  assert.equal(await resolveExtraEuShipping({ countryCode: 'IT', goodsCents: 9900 }), null)
  assert.equal(await resolveExtraEuShipping({ countryCode: 'DE', goodsCents: 9900 }), null)
})

test('resolveExtraEuShipping: con la quota live il prezzo nasce dal costo documentato', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'CH',
    goodsCents: 9900,
    destination: { zip: '4058', city: 'Basel' },
    items: [{ sku: 'T-3D-WMN-BCK', quantity: 1 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => quoteResponse()),
  })
  assert.ok(resolution)
  assert.equal(resolution.source, 'live_quote')
  assert.equal(resolution.verified, true)
  // base 47,29 (la quota del servizio sulla copertura approvata, stima uguale),
  // +10% = 52,02
  assert.equal(resolution.basisCostCents, 4729)
  assert.equal(resolution.marginCents, 473)
  assert.equal(resolution.costCents, 5202)
  assert.equal(resolution.minimumChargeApplied, false)
  assert.equal(resolution.quote?.checkoutInvoiceNumber, 'TFC-WEB-00011')
})

test('resolveExtraEuShipping: sotto il pavimento vince il pavimento', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'GB',
    goodsCents: 2390,
    destination: { zip: 'SW1A 1AA', city: 'London' },
    items: [{ sku: 'TS-A4', quantity: 1 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() =>
      quoteResponse({
        transport: 18.5,
        import_charges: 13.3,
        shipping_and_import: 38.45,
        landed_cost_estimate: 38.45,
        insurance_coverage: {
          policy: 'goods_plus_shipping',
          base: 60.83,
          rate: 0.025,
          premium: 1.52,
          premium_quoted: 1.52,
          premium_agrees: true,
        },
        checkout_invoice_number: 'TFC-WEB-00069',
      }),
    ),
  })
  assert.ok(resolution)
  assert.equal(resolution.costCents, 4800)
  assert.equal(resolution.minimumChargeApplied, true)
})

test('resolveExtraEuShipping: senza quota live il prezzo e quello prudenziale di prima', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'CH',
    goodsCents: 9900,
    items: [{ sku: 'T-3D-WMN-BCK', quantity: 1 }],
    quoteConfig: { ...QUOTE_CONFIG, enabled: false },
  })
  assert.ok(resolution)
  assert.equal(resolution.quote, null)
  assert.equal(resolution.quoteFailure, 'disabled')
  assert.equal(resolution.verified, false)
  // parita' con la tariffa prudenziale gia' in produzione (52,02 sul caso misurato)
  const deployed = Math.round(calculateShipping(99, 'CH').cost * 100)
  assert.equal(resolution.costCents, deployed)
})

test('resolveExtraEuShipping: la quota gonfiata dalla quantita non si incassa', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'US',
    goodsCents: 5000,
    items: [{ sku: 'TS-A5', quantity: 4 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() =>
      quoteResponse(
        { transport: 42.75, import_charges: 25.45, ddp_fee: 10.71, shipping_and_import: 84.9, landed_cost_estimate: 86.42 },
        { goods_value: 50 },
      ),
    ),
  })
  assert.ok(resolution)
  assert.equal(resolution.quote, null)
  assert.equal(resolution.quoteFailure, 'inconsistent_import_charges')
  assert.equal(resolution.source, 'price_table')
  // base = max(profilo, banda reale 76,78) e mai sotto la banda misurata
  assert.equal(resolution.tableCostCents, 7678)
  assert.equal(resolution.basisCostCents, Math.max(7678, profileCostCents('US', 5000) ?? 0))
  assert.ok(resolution.costCents >= 7678 + Math.round(7678 * 0.1))
})

test('resolveExtraEuShipping: il gettone incassa ESATTAMENTE il prezzo mostrato', async () => {
  // Il carrello mostra il prezzo della route /api/spedizione/quote, che firma il
  // gettone con QUEL prezzo (margine gia' dentro). Il checkout riusa lo stesso
  // gettone: deve incassare lo stesso importo. Prima della correzione del
  // 21/09/2026 incassava il prezzo mostrato +10% (52,49 mostrato, 57,74
  // incassato), perche' il gettone veniva piegato dentro la BASE di costo e il
  // margine veniva applicato una seconda volta.
  const items = [{ sku: 'T-3D-WMN-BCK', quantity: 1 }]
  const fingerprint = cartFingerprint(items, 'CH')
  const cases = [
    { nome: 'quota live', extra: { quoteConfig: QUOTE_CONFIG, fetchImpl: stubFetch(() => quoteResponse()) } },
    { nome: 'base prudenziale', extra: { quoteConfig: { ...QUOTE_CONFIG, enabled: false } } },
  ]
  for (const scenario of cases) {
    const options = {
      countryCode: 'CH',
      goodsCents: 9900,
      items,
      destination: { zip: '4058', city: 'Basel' },
      ...scenario.extra,
    }
    const shown = await resolveExtraEuShipping(options)
    assert.ok(shown, scenario.nome)
    assert.equal(shown.costCents, 5202, scenario.nome)
    const token = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: shown.costCents })
    assert.ok(token, scenario.nome)
    const charged = await resolveExtraEuShipping({ ...options, quoteToken: token })
    assert.ok(charged, scenario.nome)
    assert.equal(charged.costCents, shown.costCents, scenario.nome)
    // il gettone non e' la base di costo: il prezzo non cambia anche senza
    const control = await resolveExtraEuShipping(options)
    assert.ok(control, scenario.nome)
    assert.equal(control.costCents, shown.costCents, scenario.nome)
  }
})

test('resolveExtraEuShipping: il gettone non abbassa il prezzo (e non lo gonfia)', async () => {
  const items = [{ sku: 'T-3D-WMN-BCK', quantity: 1 }]
  const fingerprint = cartFingerprint(items, 'CH')
  const options = {
    countryCode: 'CH',
    goodsCents: 9900,
    items,
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => quoteResponse()),
  }
  // gettone SOTTO la base fresca (4.000 < 4.729): vince la base fresca
  const lower = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 4000 })
  assert.ok(lower)
  const withLower = await resolveExtraEuShipping({ ...options, quoteToken: lower })
  assert.ok(withLower)
  assert.equal(withLower.costCents, 5202)
  // gettone FRA la base e il prezzo (4.729 < 5.000 < 5.202): vince il prezzo
  // fresco, non `gettone + 10%` (che sarebbe 5.500)
  const middle = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5000 })
  assert.ok(middle)
  const withMiddle = await resolveExtraEuShipping({ ...options, quoteToken: middle })
  assert.ok(withMiddle)
  assert.equal(withMiddle.costCents, 5202)
  assert.equal(withMiddle.basisCostCents, 4729)
  assert.equal(withMiddle.minimumChargeApplied, false)
})

test('resolveExtraEuShipping: un carrello con pack non viene mai mandato alla quota', async () => {
  // Lo sku del pack non e' una variante del catalogo doganale: la guardia vive
  // nel resolver (non solo nella route), cosi' vale anche per il checkout.
  assert.equal(isPackSku('T-3D-WMN-BCK-pack-2'), true)
  assert.equal(isPackSku('T-3D-WMN-BCK-PACK-2'), true)
  assert.equal(isPackSku('T-3D-WMN-BCK'), false)
  assert.equal(isPackSku(undefined), false)
  let calls = 0
  const resolution = await resolveExtraEuShipping({
    countryCode: 'CH',
    goodsCents: 19_800,
    items: [{ sku: 'T-3D-WMN-BCK-pack-2', quantity: 1 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() => {
      calls += 1
      return quoteResponse()
    }),
  })
  assert.ok(resolution)
  assert.equal(calls, 0)
  assert.equal(resolution.quote, null)
  assert.equal(resolution.quoteFailure, 'unsupported_cart_line')
  assert.equal(resolution.verified, false)
  assert.ok(resolution.costCents > 0)
})

test('su ogni destinazione extra-UE il prezzo e un intero di centesimi, mai zero', async () => {
  for (const country of ['CH', 'GB', 'NO', 'CA', 'AU', 'JP', 'US', 'BR']) {
    for (const goods of [0, 2390, 9900, 25_000, 500_000]) {
      const resolution = await resolveExtraEuShipping({
        countryCode: country,
        goodsCents: goods,
        items: [{ sku: 'TS-A4', quantity: 1 }],
        quoteConfig: { ...QUOTE_CONFIG, enabled: false },
      })
      assert.ok(resolution, `${country} ${goods}`)
      assert.ok(Number.isSafeInteger(resolution.costCents), `${country} ${goods}`)
      assert.ok(resolution.costCents > 0, `${country} ${goods}`)
      assert.ok(resolution.costCents >= Math.round(EXTRA_EU_MINIMUM_SHIPPING * 100), `${country} ${goods}`)
    }
  }
})

// ---------------------------------------------------------------------------
// LEGAME CON IL SERVIZIO (card t_88c2ad81).
//
// Il servizio dichiarava `landed_cost_estimate = shipping_and_import + 1,52`
// hardcoded («Packlink ricalcola l'assicurazione all'acquisto su una base piu'
// alta, 160»): smentito il 21/09/2026 — le due quote differiscono SOLO per la
// base assicurata (premio = 2,5% x base: 99 -> 2,48, 160 -> 4,00). La tabella
// in casa era stata generata da quel servizio, quindi portava il +1,52 dentro
// OGNI banda (CH 4772 invece di 4729) e da li' il prezzo al cliente (52,49
// invece di 52,02). La copertura approvata da Alessandro (21/09/2026 16:35) e'
// `goods_plus_shipping`: base = valore merce + costo di spedizione sostenuto,
// premio escluso.
//
// Questi test legano la base del prezzo del negozio a quella APPROVATA del
// servizio, banda per banda e valore di merce per valore di merce.
// ---------------------------------------------------------------------------

const APPROVED_COVERAGE_POLICY = 'goods_plus_shipping'
const APPROVED_INSURANCE_RATE = 0.025

interface RawBand {
  goods_value_cents: number
  shipping_and_import_cents: number
  landed_cost_cents: number
  cost_basis_cents: number
  insurance_coverage_policy?: string
  insurance_base_cents?: number
  insurance_premium_cents?: number
}

const rawTable = landedCostTable as unknown as { countries: Record<string, { bands: RawBand[] }> }

test('la base in casa e la base approvata del servizio, banda per banda', () => {
  const codes = Object.keys(rawTable.countries)
  assert.ok(codes.length >= 6, `paesi in tabella: ${codes.join(', ')}`)
  let bands = 0
  for (const [code, entry] of Object.entries(rawTable.countries)) {
    for (const band of entry.bands) {
      bands += 1
      const where = `${code} merce ${band.goods_value_cents}`
      // il +1,52 hardcoded del servizio non deve tornare in casa, in nessuna forma
      assert.equal(
        band.landed_cost_cents,
        band.shipping_and_import_cents,
        `${where}: stima su una copertura diversa da quella approvata`,
      )
      // la base del prezzo e' la quota del servizio sulla copertura approvata
      assert.equal(
        band.cost_basis_cents,
        band.shipping_and_import_cents,
        `${where}: base di prezzo diversa dalla quota del servizio`,
      )
      // la copertura approvata e' DICHIARATA nella banda, non dedotta
      assert.equal(band.insurance_coverage_policy, APPROVED_COVERAGE_POLICY, `${where}: copertura non dichiarata`)
      const base = band.insurance_base_cents
      const premium = band.insurance_premium_cents
      assert.ok(
        typeof base === 'number' && typeof premium === 'number',
        `${where}: banda senza base/premio assicurativo dichiarati`,
      )
      // base assicurata = merce + costo di spedizione sostenuto, premio escluso
      assert.equal(
        base,
        band.goods_value_cents + band.shipping_and_import_cents - premium,
        `${where}: base assicurata diversa da merce + spedizione (premio escluso)`,
      )
      assert.equal(premium, Math.round(base * APPROVED_INSURANCE_RATE), `${where}: premio diverso dal 2,5% della base`)
    }
  }
  assert.ok(bands >= 8, `bande controllate: ${bands}`)
})

test('tableCostCents restituisce la base del servizio, non una stima di casa', () => {
  for (const [code, entry] of Object.entries(rawTable.countries)) {
    for (const band of entry.bands) {
      assert.equal(
        tableCostCents(code, band.goods_value_cents),
        band.shipping_and_import_cents,
        `${code} merce ${band.goods_value_cents}: la base in casa non e' quella del servizio`,
      )
    }
  }
})

test('una quota con un margine NON dichiarato non e una base di prezzo', () => {
  // risposta del servizio prima della correzione: +1,52 senza copertura dichiarata
  const legacy = quoteResponse({
    shipping_and_import: 46.2,
    landed_cost_estimate: 47.72,
    insurance_coverage: undefined,
  })
  assert.equal(parseQuoteResponse(legacy), null, 'margine non dichiarato accettato come base di prezzo')

  // risposta APPROVATA: stima allineata alla quota, copertura dichiarata e misurata
  const approved = quoteResponse({
    shipping_and_import: 47.29,
    insurance: 3.57,
    landed_cost_estimate: 47.29,
    insurance_coverage: {
      policy: APPROVED_COVERAGE_POLICY,
      base: 142.72,
      declared_goods_value: 99,
      shipping_cost_excluding_premium: 43.72,
      rate: APPROVED_INSURANCE_RATE,
      premium: 3.57,
      premium_quoted: 3.57,
      premium_agrees: true,
    },
  })
  const quote = parseQuoteResponse(approved)
  assert.ok(quote, 'la quota approvata non si legge')
  assert.equal(quote.shippingAndImportCents, 4729)
  assert.equal(quote.landedCostCents, 4729)
  assert.equal(quote.insuranceCoverage?.policy, APPROVED_COVERAGE_POLICY)
  assert.equal(quote.insuranceCoverage?.baseCents, 14272)
  assert.equal(quote.insuranceCoverage?.premiumCents, 357)

  // una copertura che dichiara un premio diverso dalla sua regola non e' un prezzo
  const disagreeing = quoteResponse({
    insurance_coverage: { policy: APPROVED_COVERAGE_POLICY, base: 142.72, premium: 5.5, premium_agrees: false },
  })
  assert.equal(parseQuoteResponse(disagreeing), null, 'copertura che contraddice la sua regola')
})

test('il costo approvato del caso misurato vale in tutti e tre i percorsi', async () => {
  // ordine 31: merce 99,00 CH — costo 47,29 e prezzo 52,02 (servizio, 21/09/2026)
  assert.equal(profileCostCents('CH', 9900), 4729, 'la stima in casa non riproduce la misura approvata')
  assert.equal(tableCostCents('CH', 9900), 4729, 'la tabella in casa non e la base del servizio')
  assert.equal(prudentialExtraEuPriceCents('CH', 9900), 5202)

  const live = await resolveExtraEuShipping({
    countryCode: 'CH',
    goodsCents: 9900,
    destination: { zip: '4058', city: 'Basel' },
    items: [{ sku: 'T-3D-WMN-BCK', quantity: 1 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() =>
      quoteResponse({
        shipping_and_import: 47.29,
        insurance: 3.57,
        landed_cost_estimate: 47.29,
        insurance_coverage: {
          policy: APPROVED_COVERAGE_POLICY,
          base: 142.72,
          rate: APPROVED_INSURANCE_RATE,
          premium: 3.57,
          premium_quoted: 3.57,
          premium_agrees: true,
        },
      }),
    ),
  })
  assert.ok(live)
  assert.equal(live.basisCostCents, 4729)
  assert.equal(live.costCents, 5202)
  assert.equal(live.source, 'live_quote')
})
