import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  DDP_CAPABLE_CARRIER,
  DEFAULT_EXTRA_EU_PROFILE,
  SWITZERLAND_PROFILE,
  UNCALIBRATED_EXTRA_EU_FLAT,
  UNCALIBRATED_EXTRA_EU_POLICY,
  calculateLandedCost,
  calculateShipping,
  freeShippingRemaining,
  getShippingZone,
  isFreeShippingPromoAllowed,
  shippingRequiresQuote,
  uncalibratedExtraEuProfile,
} from './shipping'

/**
 * Il caso che ha aperto il problema, nudo e crudo: ordine CMS 31 / Basel CH,
 * merce 99,00 EUR, collo 40x40x10 / 2,0 kg.
 *   corriere 23,00 + gestione 0,99 + assicurazione 4,00 + dogana 14,77 + DDP 4,96
 *   = 47,72 EUR reali, contro 14,99 EUR incassati.
 * E la scomposizione reale di quei 14,77: dazi 0,00 + IVA 9,88 + sdoganamento 4,89.
 */
const MEASURED_ORDER = { goods: 99, total: 47.72, importVat: 9.88, importFee: 4.89 }

test('la Svizzera e la Norvegia sono extra-UE, non Europa: e\' la causa della perdita', () => {
  // Il difetto originale: il confine era continentale, non doganale.
  assert.equal(getShippingZone('CH'), 'EXTRA_EU')
  assert.equal(getShippingZone('NO'), 'EXTRA_EU')
  assert.equal(getShippingZone('GB'), 'EXTRA_EU')
  assert.equal(getShippingZone('US'), 'EXTRA_EU')
  assert.equal(getShippingZone('ch'), 'EXTRA_EU', 'le maiuscole non devono cambiare la zona')
  // Nessun cambiamento per chi e' nel territorio doganale.
  assert.equal(getShippingZone('IT'), 'IT')
  assert.equal(getShippingZone('DE'), 'EU')
  assert.equal(getShippingZone('SE'), 'EU')
})

test('l\'ordine misurato viene ricostruito al centesimo, voce per voce', () => {
  const rate = calculateShipping(MEASURED_ORDER.goods, 'CH')

  assert.equal(rate.zone, 'EXTRA_EU')
  assert.equal(rate.cost, MEASURED_ORDER.total)
  assert.ok(rate.landedCost)
  if (!rate.landedCost) return

  // Scomposizione della misura reale (47,72 = 23,00 + 0,99 + 4,00 + 14,77 + 4,96).
  assert.equal(rate.landedCost.carrier, 23.0)
  assert.equal(rate.landedCost.handlingFee, 0.99)
  assert.equal(rate.landedCost.insurance, 4.0)
  assert.equal(rate.landedCost.ddpFee, 4.96)
  assert.equal(rate.landedCost.duty, 0, 'cap. 25-97 esenti dal 1/1/2024')
  // MISURATO dentro i customs_and_duties: IVA 9,88 e sdoganamento 4,89.
  // L'IVA e' 8,1% di (merce 99,00 + trasporto REALE 23,00) = 9,88.
  assert.equal(rate.landedCost.importVat, MEASURED_ORDER.importVat)
  // Le spese di sdoganamento sono una voce misurata (import_fees_amount), non il
  // residuo dei 14,77 che l'IVA non spiega: il vecchio 4,08 era compensazione.
  assert.equal(rate.landedCost.fixedImportFee, MEASURED_ORDER.importFee)
  assert.equal(rate.landedCost.estimatedCost, MEASURED_ORDER.total)
  assert.equal(rate.landedCost.total, MEASURED_ORDER.total)
  assert.equal(rate.landedCost.margin, 0, 'punto di prezzo: a costo finche\' non lo decide Alessandro')
  assert.equal(rate.landedCost.calibrated, true)
  assert.ok(rate.landedCost.source.includes('CMS 31'))
  // La somma dei componenti e' il totale: nessuna voce invisibile.
  assert.equal(
    Math.round((
      rate.landedCost.carrier
      + rate.landedCost.insurance
      + rate.landedCost.duty
      + rate.landedCost.importVat
      + rate.landedCost.fixedImportFee
      + rate.landedCost.ddpFee
      + rate.landedCost.handlingFee
    ) * 100) / 100,
    MEASURED_ORDER.total,
  )
})

test('le regole misurate valgono fuori dal punto misurato (non e\' una compensazione)', () => {
  // Il difetto che questa prova blocca: con fixedImportFee scelto come residuo
  // (4,08) il totale tornava a 99,00 di merce per costruzione e sbagliava di
  // segno altrove. Ora la voce fissa e' misurata: NON puo' cambiare con la merce.
  for (const goods of [0, 30, 99, 150, 500, 2500]) {
    const landed = calculateLandedCost(goods, SWITZERLAND_PROFILE)
    assert.equal(
      landed.fixedImportFee,
      MEASURED_ORDER.importFee,
      `${goods}: la spesa di sdoganamento non e' piu' un residuo`,
    )
    // Base imponibile IVA = merce + trasporto REALE (non anche assicurazione,
    // gestione e fee DDP come prima).
    const base = Math.round((goods + SWITZERLAND_PROFILE.carrier) * 100) / 100
    assert.equal(landed.importVat, Math.round(base * SWITZERLAND_PROFILE.importVatRate * 100) / 100)
  }

  // Ancora esterna: questi totali sono quelli calcolati in modo indipendente
  // (ipotesi "il valore assicurato segue la merce") sulla misura di Alfred.
  const anchors: Array<[number, number]> = [
    [30, 39.34],
    [50, 41.77],
    [99, 47.72],
    [150, 53.91],
    [200, 59.98],
    [300, 72.12],
    [500, 96.40],
  ]
  for (const [goods, expected] of anchors) {
    assert.equal(
      calculateShipping(goods, 'CH').cost,
      expected,
      `${goods} EUR di merce: il profilo non riproduce il costo calcolato dalla misura`,
    )
  }
})

test('nessuna spedizione extra-UE parte sotto il costo sdoganato stimato', () => {
  // Criterio di accettazione n.1, su tutti i paesi extra-UE ammessi e su un
  // intervallo di valori merce (compresi carrelli minuscoli e molto grandi),
  // con la politica di default E con quella prudenziale.
  const values = [0, 1, 9.99, 25, 47.5, 99, 150, 249.99, 250, 400, 999.99, 2500, 10000]

  for (const policy of ['quote_required', 'conservative_profile'] as const) {
    for (const country of ALLOWED_SHIPPING_COUNTRIES) {
      if (getShippingZone(country) !== 'EXTRA_EU') continue
      for (const goods of values) {
        const rate = calculateShipping(goods, country, policy)

        // Paese senza misura: non si incassa nulla e non si inventa un prezzo.
        if (rate.requiresQuote) {
          assert.equal(rate.cost, 0, `${country} @ ${goods} [${policy}]: un preventivo non incassa`)
          assert.equal(rate.landedCost, null, `${country} @ ${goods} [${policy}]: nessuna stima inventata`)
          assert.equal(rate.isFree, false)
          continue
        }

        assert.ok(rate.landedCost, `${country} @ ${goods} [${policy}]: manca la scomposizione`)
        if (!rate.landedCost) continue
        assert.equal(rate.isFree, false, `${country} @ ${goods}: spedizione gratuita su extra-UE`)
        assert.ok(
          rate.cost >= rate.landedCost.estimatedCost,
          `${country} @ ${goods} [${policy}]: addebitato ${rate.cost} < costo stimato ${rate.landedCost.estimatedCost}`,
        )
        assert.ok(rate.cost > 0, `${country} @ ${goods} [${policy}]: costo non addebitato`)
        // Il costo e' un importo in centesimi: niente frazioni di centesimo.
        assert.equal(Number.isInteger(Math.round(rate.cost * 100)), true)
        assert.equal(Math.round(rate.cost * 100) / 100, rate.cost)
      }
    }
  }
})

test('su extra-UE una promo "spedizione gratuita" non puo\' azzerare la tariffa', () => {
  assert.equal(isFreeShippingPromoAllowed('CH'), false)
  assert.equal(isFreeShippingPromoAllowed('NO'), false)
  assert.equal(isFreeShippingPromoAllowed('IT'), true)
  assert.equal(isFreeShippingPromoAllowed('DE'), true)
})

test('il costo sdoganato cresce col valore della merce (nessun buco per eccesso di valore)', () => {
  let previous = 0
  for (const goods of [10, 25, 50, 99, 200, 500, 1000, 5000]) {
    const rate = calculateShipping(goods, 'CH')
    assert.ok(rate.cost >= previous, `${goods}: il costo e' sceso al crescere della merce`)
    previous = rate.cost
  }
})

test('un paese extra-UE non ancora misurato si quota, non si indovina (default)', () => {
  assert.equal(UNCALIBRATED_EXTRA_EU_POLICY, 'quote_required', 'il default resta fail-closed')

  for (const country of ['US', 'GB', 'CA', 'AU', 'JP', 'BR', 'NO'] as const) {
    const rate = calculateShipping(99, country)
    assert.equal(rate.zone, 'EXTRA_EU')
    assert.equal(rate.requiresQuote, true, `${country}: venduto con un prezzo non misurato`)
    assert.equal(rate.cost, 0)
    assert.equal(rate.landedCost, null)
    assert.equal(shippingRequiresQuote(country), true)
  }

  // La Svizzera e' misurata: si vende, e non si quota.
  assert.equal(shippingRequiresQuote('CH'), false)
  assert.equal(shippingRequiresQuote('IT'), false)
  assert.equal(shippingRequiresQuote('DE'), false)
})

test('il Brasile non ha alcuna linea DDP: resta in preventivo anche girando la politica', () => {
  // Non e' prudenza: il 21/09/2026 l'account non ha nessun servizio DDP verso BR,
  // quindi il modello landed-cost non e' costruibile e non si applica.
  assert.equal(DDP_CAPABLE_CARRIER.BR, undefined)
  assert.equal(uncalibratedExtraEuProfile('BR'), null)
  assert.equal(shippingRequiresQuote('BR'), true)
  assert.equal(shippingRequiresQuote('BR', 'conservative_profile'), true)
  assert.equal(calculateShipping(99, 'BR', 'conservative_profile').cost, 0)
  assert.equal(calculateShipping(99, 'BR', 'conservative_profile').landedCost, null)
})

test('la politica prudenziale usa la linea DDP-capace, mai il preventivo piu\' economico', () => {
  // Preventivi Packlink 21/09/2026, collo 40x40x10 / 2,0 kg. Tutte le linee piu'
  // economiche di questi paesi NON supportano il DDP (`ddp: None`): la loro
  // carrier non e' un'alternativa a parita' di servizio.
  const cheapestQuote = { NO: 17.97, CA: 33.04, AU: 37.84, JP: 57.44 } as const

  for (const [country, cheapest] of Object.entries(cheapestQuote)) {
    const profile = uncalibratedExtraEuProfile(country as keyof typeof cheapestQuote)
    assert.ok(profile, `${country}: manca il profilo prudenziale`)
    if (!profile) continue
    assert.ok(
      profile.carrier > cheapest,
      `${country}: carrier ${profile.carrier} = la piu' economica (${cheapest}), che non ha DDP`,
    )
    assert.equal(profile.carrier, DDP_CAPABLE_CARRIER[country as keyof typeof cheapestQuote]?.carrier)
    assert.equal(profile.calibrated, false)
  }

  // GB e US hanno un costo PAGATO: e' quello che entra nel profilo.
  assert.equal(uncalibratedExtraEuProfile('GB')?.carrier, 18.50)
  assert.equal(uncalibratedExtraEuProfile('US')?.carrier, 37.60)

  for (const country of ['US', 'GB', 'NO', 'CA', 'AU', 'JP'] as const) {
    const profile = uncalibratedExtraEuProfile(country)
    assert.ok(profile)
    if (!profile) continue
    // Il profilo prudenziale tiene le regole CH e le dichiara nel source.
    assert.equal(profile.fixedImportFee, DEFAULT_EXTRA_EU_PROFILE.fixedImportFee)
    assert.equal(profile.importVatRate, DEFAULT_EXTRA_EU_PROFILE.importVatRate)
    assert.equal(profile.dutyRate, DEFAULT_EXTRA_EU_PROFILE.dutyRate)
    assert.equal(profile.calibrated, false)
    assert.equal(profile.source.startsWith('prudenziale'), true)
    assert.ok(profile.source.includes('NON misurati'), `${country}: gli oneri import non sono misurati`)

    const rate = calculateShipping(99, country, 'conservative_profile')
    assert.equal(rate.requiresQuote, false)
    assert.ok(rate.landedCost)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.carrier, profile.carrier)
    assert.ok(rate.cost >= UNCALIBRATED_EXTRA_EU_FLAT, `${country}: sotto il pavimento storico`)
    assert.ok(rate.cost >= rate.landedCost.estimatedCost)
  }
})

test('un carrello non finito non diventa un prezzo NaN e il margine non puo\' essere negativo', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rate = calculateShipping(bad, 'CH')
    assert.ok(Number.isFinite(rate.cost), `${bad}: prezzo non finito`)
    // Senza merce restano il trasporto, gli oneri fissi e l'IVA minima:
    // 23,00 + 0,99 + 4,89 + 4,96 + 1,86 (8,1% su 23,00).
    assert.equal(rate.cost, 35.70)
  }

  // Nessuna configurazione puo' far partire una spedizione sotto costo.
  const greedy = calculateLandedCost(99, { ...SWITZERLAND_PROFILE, marginRate: -0.5 })
  assert.equal(greedy.estimatedCost, 47.72)
  assert.equal(greedy.total, 47.72)
  assert.equal(greedy.margin, 0)
})

test('Italia e Unione Europea restano come erano', () => {
  const italy = calculateShipping(49.99, 'IT')
  assert.equal(italy.zone, 'IT')
  assert.equal(italy.cost, 7.65)
  assert.equal(italy.landedCost, null)
  assert.equal(italy.freeAbove, 50)
  assert.equal(calculateShipping(50, 'IT').cost, 0)

  const germany = calculateShipping(99, 'DE')
  assert.equal(germany.zone, 'EU')
  assert.equal(germany.cost, 14.99)
  assert.equal(germany.landedCost, null)
  assert.equal(germany.freeAbove, 150)
  assert.equal(calculateShipping(150, 'DE').cost, 0)
  assert.equal(calculateShipping(300, 'DE').cost, 0)
})

test('la barra della spedizione gratuita non esiste su extra-UE', () => {
  assert.equal(freeShippingRemaining(20, 'IT'), 30)
  assert.equal(freeShippingRemaining(60, 'IT'), 0)
  assert.equal(freeShippingRemaining(20, 'DE'), 130)
  assert.equal(freeShippingRemaining(20, 'CH'), 0)
  assert.equal(freeShippingRemaining(20, 'US'), 0)
})

test('su extra-UE la spedizione non e\' mai gratuita, nemmeno su un carrello enorme', () => {
  const rate = calculateShipping(10000, 'CH')
  assert.equal(rate.freeAbove, null)
  assert.equal(rate.isFree, false)
  assert.ok(rate.cost > 0)
  // A 10.000 EUR la componente proporzionale domina: il costo sdoganato e'
  // oltre i 1.000 EUR, non una tariffa piatta.
  assert.ok(rate.cost > 1000)
})

test('il profilo CH usa la misura come fonte, non un numero inventato', () => {
  assert.equal(SWITZERLAND_PROFILE.calibrated, true)
  assert.equal(SWITZERLAND_PROFILE.source.includes('misurato'), true)
  assert.equal(SWITZERLAND_PROFILE.importVatExemptBelow, null, 'de minimis spenta: il cambio non e\' confermato')
  assert.equal(SWITZERLAND_PROFILE.freeAbove, null)
  assert.equal(SWITZERLAND_PROFILE.marginRate, 0)
  assert.equal(SWITZERLAND_PROFILE.freeShippingPromoAllowed, false)
})

test('la soglia di de minimis, se accesa, abbassa il costo senza scendere sotto il trasporto', () => {
  const exempt = calculateLandedCost(40, { ...SWITZERLAND_PROFILE, importVatExemptBelow: 500 })
  const taxed = calculateLandedCost(40, SWITZERLAND_PROFILE)
  assert.equal(exempt.importVat, 0)
  assert.ok(exempt.total < taxed.total)
  assert.ok(exempt.total >= exempt.carrier + exempt.ddpFee + exempt.handlingFee)
})
