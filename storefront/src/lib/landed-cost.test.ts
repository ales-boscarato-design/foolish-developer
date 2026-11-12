/**
 * Test della catena di prezzo extra-UE (quota live + tabella in casa + profilo).
 *
 * I numeri usati qui vengono dalle quote REALI del servizio: la tabella in casa
 * e' quella rigenerata l'11/11/2026 da `POST /landed-cost/v1/quote` (fatture
 * TFC-WEB-016xx) e le fixture copiano la forma di quella risposta, non una
 * forma comoda.
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
import { EXTRA_EU_MINIMUM_SHIPPING, INSURANCE_RULE, calculateShipping } from './shipping'
import { prudentialExtraEuPriceCents } from './landed-cost-price'
import landedCostTable from './landed-cost-table.json'

/** Il documento della tabella come sta su disco (per camminare le bande generate). */
function landedCostTableDocument(): Record<string, unknown> {
  return landedCostTable as unknown as Record<string, unknown>
}

const TOKEN_SECRET = 'test-only-token-secret'
process.env.SHIPPING_QUOTE_TOKEN_SECRET = TOKEN_SECRET

const QUOTE_CONFIG = { url: 'https://quote.test/landed-cost/v1/quote', secret: 'test-shared-secret', enabled: true }

/**
 * Risposta del servizio di quota con la forma REALE (CH, Basel, merce 99),
 * copiata dalla quota dell'11/11/2026 (fattura TFC-WEB-01642): la copertura
 * assicurata e' dichiarata (`goods_plus_shipping`) e `landed_cost_estimate`
 * coincide con `shipping_and_import`, perche' il premio della base approvata e'
 * gia' dentro la quota. E' la forma che il servizio in esercizio produce.
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
        management_fee: 0.99,
        insurance: 3.57,
        import_charges: 14.93,
        ddp_fee: 5.0,
        shipping_and_import: 47.49,
        landed_cost_estimate: 47.49,
        insurance_coverage: {
          policy: 'goods_plus_shipping',
          base: 142.92,
          base_source: 'goods_value_plus_shipping_cost',
          declared_goods_value: 99,
          shipping_cost_excluding_premium: 43.92,
          rate: 0.025,
          premium: 3.57,
          premium_quoted: 3.57,
          premium_agrees: true,
          premium_delta: 0,
          minimum_premium: 0.99,
          extra_cost: 0,
          extra_cost_vs_goods_value: 1.09,
          base_set_at: 'purchase',
        },
        checkout_invoice_number: 'TFC-WEB-01642',
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
  assert.equal(quote.shippingAndImportCents, 4749)
  // l'invariante vale anche sul dato reale: stima e quota sono lo stesso numero
  assert.equal(quote.landedCostCents, 4749)
  assert.equal(quote.transportCents, 2300)
  assert.equal(quote.importChargesCents, 1493)
  assert.equal(quote.checkoutInvoiceNumber, 'TFC-WEB-01642')
  assert.equal(quote.serviceId, 22131)
  assert.equal(quote.goodsValueCents, 9900)
  assert.deepEqual(quote.parcel, { weightKg: 2, widthCm: 40, heightCm: 10, lengthCm: 40, packages: 1 })
})

test('parseQuoteResponse espone insurance_coverage: presente, assente, a zero', () => {
  // PRESENTE: la copertura dichiarata si legge per intero, non si deduce da una
  // differenza fra due campi.
  const present = parseQuoteResponse(quoteResponse())
  assert.ok(present?.insuranceCoverage)
  assert.equal(present.insuranceCoverage.policy, 'goods_plus_shipping')
  assert.equal(present.insuranceCoverage.baseCents, 14292)
  assert.equal(present.insuranceCoverage.declaredGoodsValueCents, 9900)
  assert.equal(present.insuranceCoverage.shippingCostExcludingPremiumCents, 4392)
  assert.equal(present.insuranceCoverage.rate, 0.025)
  assert.equal(present.insuranceCoverage.premiumCents, 357)
  assert.equal(present.insuranceCoverage.premiumQuotedCents, 357)
  assert.equal(present.insuranceCoverage.premiumAgrees, true)
  assert.equal(present.insuranceCoverage.extraCostCents, 0)
  assert.equal(present.insuranceCoverage.baseSetAt, 'purchase')

  // ASSENTE: la quota resta valida (e' la forma dei servizi che non dichiarano
  // la copertura), ma la copertura e' null e non si inventa.
  const absent = parseQuoteResponse(quoteResponse({ insurance_coverage: undefined }))
  assert.ok(absent)
  assert.equal(absent.insuranceCoverage, null)

  // A ZERO: `extra_cost: 0` e' un valore dichiarato ("nessuna differenza"), non
  // un'assenza — a zero non si legge come "copertura non dichiarata".
  const zero = parseQuoteResponse(quoteResponse())
  assert.equal(zero?.insuranceCoverage?.extraCostCents, 0)
  // una copertura SENZA base o SENZA premio non e' una copertura dichiarata
  assert.equal(parseQuoteResponse(quoteResponse({ insurance_coverage: { policy: 'goods_plus_shipping', base: 0, premium: 0 } }))?.insuranceCoverage, null)
})

test('parseQuoteResponse scarta le quote senza dazi, senza fee DDP o senza forma', () => {
  assert.equal(parseQuoteResponse(null), null)
  assert.equal(parseQuoteResponse({ status: 'ok', services: [] }), null)
  assert.equal(parseQuoteResponse(quoteResponse({}, { status: 'error' })), null)
  // trappola misurata: 200 con dazi a 0,00 quando manca la fattura doganale
  assert.equal(parseQuoteResponse(quoteResponse({ import_charges: 0 })), null)
  assert.equal(parseQuoteResponse(quoteResponse({ ddp_fee: 0 })), null)
  assert.equal(parseQuoteResponse(quoteResponse({ shipping_and_import: '47.49' })), null)
  // landed_cost_estimate sotto shipping_and_import non e' una quota coerente
  assert.equal(parseQuoteResponse(quoteResponse({ landed_cost_estimate: 40 })), null)
})

test('l invariante morde: una stima diversa dalla quota non e un prezzo', () => {
  // Il caso che ha aperto la card: la stima +1,52 sopra la quota, senza che la
  // copertura dichiari niente. Era il margine nascosto del 21/09/2026.
  assert.equal(parseQuoteResponse(quoteResponse({ landed_cost_estimate: 49.01 })), null)
  // Stessa differenza con una copertura che dichiara un extra DIVERSO: non torna.
  assert.equal(
    parseQuoteResponse(
      quoteResponse({
        landed_cost_estimate: 49.01,
        insurance_coverage: { ...(quoteResponse().services[0]!.insurance_coverage as Record<string, unknown>), extra_cost: 1.0 },
      }),
    ),
    null,
  )
  // Differenza dichiarata e coerente con `extra_cost`: la quota e' un prezzo —
  // e la base prudente e' la stima, non la quota.
  const declared = parseQuoteResponse(
    quoteResponse({
      landed_cost_estimate: 48.58,
      insurance_coverage: { ...(quoteResponse().services[0]!.insurance_coverage as Record<string, unknown>), extra_cost: 1.09 },
    }),
  )
  assert.ok(declared)
  assert.equal(declared.shippingAndImportCents, 4749)
  assert.equal(declared.landedCostCents, 4858)
  assert.equal(declared.insuranceCoverage?.extraCostCents, 109)
  // Copertura che contraddice la propria regola: non e' un prezzo.
  assert.equal(parseQuoteResponse(quoteResponse({ insurance_coverage: { ...(quoteResponse().services[0]!.insurance_coverage as Record<string, unknown>), premium_agrees: false } })), null)
  // Copertura che non copre nemmeno la merce: non e' la copertura approvata.
  assert.equal(parseQuoteResponse(quoteResponse({ insurance_coverage: { ...(quoteResponse().services[0]!.insurance_coverage as Record<string, unknown>), base: 50 } })), null)
})

test('parseQuoteResponse prende il servizio DDP piu economico', () => {
  const body = quoteResponse()
  body.services.push({
    ...body.services[0]!,
    service_id: 999,
    shipping_and_import: 41.5,
    landed_cost_estimate: 41.5,
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
      CH: { bands: [{ goods_value_cents: 0, cost_basis_cents: 4749, shipping_and_import_cents: 4749 }] },
      GB: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 'x', shipping_and_import_cents: 4749 }] },
      zzz: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 4749, shipping_and_import_cents: 4749 }] },
      NO: { bands: [{ goods_value_cents: 9900, cost_basis_cents: 7427, shipping_and_import_cents: 7427 }] },
    },
  })
  assert.equal(malformed.get('CH'), undefined)
  assert.equal(malformed.get('GB'), undefined)
  assert.equal(malformed.get('ZZZ'), undefined)
  assert.equal(malformed.get('NO')?.length, 1)
})

test('ogni banda della tabella rispetta l invariante e dichiara la copertura', () => {
  // La tabella nasce da quote reali: se una banda porta una stima diversa dalla
  // quota, il prezzo in casa e' un margine che nessuno ha approvato. Il test
  // cammina la tabella GENERATA, non una fixture: una rigenerazione che porta
  // dentro il +1,52 lo fa fallire qui.
  const table = loadLandedCostTable()
  const raw = landedCostTableDocument()
  let bands = 0
  for (const [country, entries] of Object.entries(raw.countries as Record<string, { bands: Record<string, unknown>[] }>)) {
    for (const band of entries.bands) {
      bands += 1
      const label = `${country} ${band.goods_value_cents}`
      assert.equal(band.landed_cost_cents, band.shipping_and_import_cents, label)
      assert.equal(band.cost_basis_cents, band.shipping_and_import_cents, label)
      // la copertura approvata e' dichiarata, e il premio e' 2,5% della base
      assert.equal(band.insurance_coverage_policy, 'goods_plus_shipping', label)
      const base = Number(band.insurance_base_cents)
      const premium = Number(band.insurance_premium_cents)
      assert.ok(Number.isSafeInteger(base) && base > 0, label)
      assert.ok(Number.isSafeInteger(premium) && premium > 0, label)
      // premio = 2,5% della base dichiarata SOTTO la soglia di scatto: da 500,00
      // la regola di Packlink passa al 3% (`INSURANCE_RULE` in shipping.ts, 11
      // punti misurati). Il servizio arrotonda a due decimali con la sua regola
      // (half-even): si pretende il centesimo, non il bit. La soglia si controlla
      // prima, cosi' una banda rigenerata oltre 500,00 dice cosa rileggere invece
      // di far sembrare sbagliata la tabella.
      assert.ok(
        base < INSURANCE_RULE.threshold * 100, // base in centesimi, soglia in euro
        `${label}: banda sopra la soglia del 3%, rileggi la regola`,
      )
      assert.ok(Math.abs(premium - base * 0.025) <= 1, `${label}: premio ${premium} su base ${base}`)
      // la base assicurata copre almeno la merce della banda
      assert.ok(base >= Number(band.goods_value_cents), label)
      // le componenti ci sono: senza trasporto e oneri import un aumento di
      // banda non si puo' spiegare
      assert.ok(Number.isSafeInteger(band.transport_cents), label)
      assert.ok(Number.isSafeInteger(band.import_charges_cents), label)
    }
  }
  assert.ok(bands >= 10, `bande lette: ${bands}`)
  // e la tabella che il negozio legge davvero ha le stesse bande
  const read = [...table.values()].reduce((sum, list) => sum + list.length, 0)
  assert.equal(read, bands)
  // la tabella dichiara da dove viene
  assert.ok(typeof raw.generated_at === 'string' && raw.generated_at.length > 0)
  assert.match(String(raw.generator_script_sha256), /^[0-9a-f]{64}$/)
})

test('tableCostCents prende la banda piu piccola che copre il carrello', () => {
  assert.equal(tableCostCents('ch', 1000), 4749)
  assert.equal(tableCostCents('CH', 9900), 4749)
  // sopra l'ultima banda resta l'ultima misura: e' un pavimento, non una stima
  assert.equal(tableCostCents('CH', 500_000), 4749)
  assert.equal(tableCostCents('GB', 1000), 3918)
  assert.equal(tableCostCents('GB', 9900), 6055)
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
  const token = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5224, now })
  assert.ok(token)
  assert.equal(verifyQuoteToken(token, { countryCode: 'ch', fingerprint, now }), 5224)
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
  assert.equal(signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5224, now }), null)
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
        landed_cost_estimate: 84.9,
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
    quoteResponse({ import_charges: 400, shipping_and_import: 423.2, landed_cost_estimate: 423.2 }),
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
  // base 47,49 (la quota del servizio: stima e quota sono lo stesso numero), +10% = 52,24
  assert.equal(resolution.basisCostCents, 4749)
  assert.equal(resolution.marginCents, 475)
  assert.equal(resolution.costCents, 5224)
  assert.equal(resolution.minimumChargeApplied, false)
  assert.equal(resolution.quote?.checkoutInvoiceNumber, 'TFC-WEB-01642')
})

test('resolveExtraEuShipping: sotto il pavimento vince il pavimento', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'GB',
    goodsCents: 2390,
    destination: { zip: 'SW1A 1AA', city: 'London' },
    items: [{ sku: 'TS-A4', quantity: 1 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() =>
      quoteResponse({ transport: 18.5, import_charges: 13.3, shipping_and_import: 38.45, landed_cost_estimate: 38.45, checkout_invoice_number: 'TFC-WEB-00069' }),
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
  // La regola prudenziale e' `max(profilo di paese, tabella in casa)` + margine
  // + pavimento: sul caso misurato la tabella (47,49, quota dell'11/11/2026)
  // vince sul profilo (47,29, misura del 21/09) e il prezzo e' 52,24.
  assert.equal(resolution.basisCostCents, 4749)
  assert.equal(resolution.profileCostCents, 4729)
  assert.equal(resolution.tableCostCents, 4749)
  assert.equal(resolution.costCents, prudentialExtraEuPriceCents('CH', 9900))
  // e non e' mai sotto quello che il profilo da solo addebiterebbe
  assert.ok(resolution.costCents >= Math.round(calculateShipping(99, 'CH').cost * 100))
})

test('resolveExtraEuShipping: la quota gonfiata dalla quantita non si incassa', async () => {
  const resolution = await resolveExtraEuShipping({
    countryCode: 'US',
    goodsCents: 5000,
    items: [{ sku: 'TS-A5', quantity: 4 }],
    quoteConfig: QUOTE_CONFIG,
    fetchImpl: stubFetch(() =>
      quoteResponse(
        { transport: 42.75, import_charges: 25.45, ddp_fee: 10.71, shipping_and_import: 84.9, landed_cost_estimate: 84.9 },
        { goods_value: 50 },
      ),
    ),
  })
  assert.ok(resolution)
  assert.equal(resolution.quote, null)
  assert.equal(resolution.quoteFailure, 'inconsistent_import_charges')
  // Base = il MAGGIORE fra profilo del paese e banda misurata: sulla merce di
  // 50,00 vince il profilo USA (82,21) sulla banda rigenerata (79,52), e il
  // test segue il lato che vince invece di fissarlo.
  // Il punto del test resta che una quota scartata non si incassa e che il
  // prezzo non scende sotto la banda.
  const profilo = profileCostCents('US', 5000) ?? 0
  assert.equal(resolution.source, profilo > 7952 ? 'profile' : 'price_table')
  assert.equal(resolution.tableCostCents, 7952)
  assert.equal(resolution.basisCostCents, Math.max(7952, profilo))
  assert.ok(resolution.costCents >= 7952 + Math.round(7952 * 0.1))
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
    {
      nome: 'quota live',
      // La quota live e la banda in casa danno lo stesso numero su CH 99,00
      // (52,24): senza questa asserzione una quota scartata dal parser severo
      // di #54 cadrebbe sulla tabella e il test resterebbe verde misurando il
      // percorso sbagliato. Qui si pretende che la quota sia stata DAVVERO usata.
      source: 'live_quote',
      extra: { quoteConfig: QUOTE_CONFIG, fetchImpl: stubFetch(() => quoteResponse()) },
    },
    {
      nome: 'base prudenziale',
      source: 'price_table',
      extra: { quoteConfig: { ...QUOTE_CONFIG, enabled: false } },
    },
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
    assert.equal(shown.source, scenario.source, `${scenario.nome}: percorso di prezzo`)
    assert.equal(shown.costCents, 5224, scenario.nome)
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
  // gettone SOTTO la base fresca (4.000 < 4.749): vince la base fresca
  const lower = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 4000 })
  assert.ok(lower)
  const withLower = await resolveExtraEuShipping({ ...options, quoteToken: lower })
  assert.ok(withLower)
  assert.equal(withLower.costCents, 5224)
  // gettone FRA la base e il prezzo (4.749 < 5.000 < 5.224): vince il prezzo
  // fresco, non `gettone + 10%` (che sarebbe 5.500)
  const middle = signQuoteToken({ countryCode: 'CH', fingerprint, costCents: 5000 })
  assert.ok(middle)
  const withMiddle = await resolveExtraEuShipping({ ...options, quoteToken: middle })
  assert.ok(withMiddle)
  assert.equal(withMiddle.costCents, 5224)
  assert.equal(withMiddle.basisCostCents, 4749)
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

test('su ogni destinazione extra-UE vendibile il prezzo e un intero di centesimi, mai zero', async () => {
  for (const country of ['CH', 'GB', 'NO', 'CA', 'AU', 'JP', 'US']) {
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

test('una destinazione senza profilo non viene prezzata: si quota a mano', async () => {
  // BR non ha una linea DDP, quindi non esiste un costo sdoganato da stimare.
  // Prima della correzione l'11/11/2026 usciva 52,49: il profilo svizzero
  // applicato come default a un paese che non ha ne' trasporto ne' aliquote sue.
  for (const goods of [0, 2390, 9900, 25_000]) {
    const resolution = await resolveExtraEuShipping({
      countryCode: 'BR',
      goodsCents: goods,
      items: [{ sku: 'TS-A4', quantity: 1 }],
      quoteConfig: { ...QUOTE_CONFIG, enabled: false },
    })
    assert.equal(resolution, null, `BR ${goods}: nessun prezzo inventato`)
  }
})
