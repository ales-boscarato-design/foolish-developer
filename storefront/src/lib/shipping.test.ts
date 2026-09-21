import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  DDP_CAPABLE_CARRIER,
  DEFAULT_EXTRA_EU_PROFILE,
  DESTINATION_TAX_RULES,
  GBP_PER_EUR,
  SWITZERLAND_PROFILE,
  UNCALIBRATED_EXTRA_EU_FLOOR,
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

  for (const policy of ['quote_required', 'destination_profile'] as const) {
    for (const country of ALLOWED_SHIPPING_COUNTRIES) {
      if (getShippingZone(country) !== 'EXTRA_EU') continue
      for (const goods of values) {
        const rate = calculateShipping(goods, country, policy)

        // Paese senza profilo (nessuna linea DDP): non si incassa nulla e non
        // si inventa un prezzo.
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
        // Paese non misurato: la rete di sicurezza e' il pavimento, non il costo.
        if (!rate.landedCost.calibrated) {
          assert.ok(
            rate.cost >= UNCALIBRATED_EXTRA_EU_FLOOR,
            `${country} @ ${goods} [${policy}]: ${rate.cost} sotto il pavimento ${UNCALIBRATED_EXTRA_EU_FLOOR}`,
          )
        }
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

test('un paese extra-UE senza misura si VENDE con le aliquote del paese di destinazione (default)', () => {
  // Decisione di Alessandro del 21/09/2026 (via alfred): niente quote_required
  // come stato definitivo. Il pavimento di 48,00 EUR e' la rete di sicurezza.
  assert.equal(UNCALIBRATED_EXTRA_EU_POLICY, 'destination_profile')

  for (const country of ['US', 'GB', 'CA', 'AU', 'JP', 'NO'] as const) {
    const rate = calculateShipping(99, country)
    assert.equal(rate.zone, 'EXTRA_EU')
    assert.equal(rate.requiresQuote, false, `${country}: un paese senza misura si vende`)
    assert.ok(rate.landedCost, `${country}: manca la scomposizione`)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.calibrated, false, `${country}: resta non misurato, e lo dichiara`)
    assert.ok(rate.cost >= UNCALIBRATED_EXTRA_EU_FLOOR)
    assert.ok(rate.cost >= rate.landedCost.estimatedCost)
    assert.equal(shippingRequiresQuote(country), false)
  }

  // La Svizzera e' misurata: si vende, e non si quota.
  assert.equal(shippingRequiresQuote('CH'), false)
  assert.equal(shippingRequiresQuote('IT'), false)
  assert.equal(shippingRequiresQuote('DE'), false)

  // Il Brasile resta l'unica destinazione in preventivo: nessuna linea DDP.
  assert.equal(shippingRequiresQuote('BR'), true)

  // L'interruttore fail-closed resta raggiungibile: si puo' tornare a quotare.
  const quoted = calculateShipping(99, 'US', 'quote_required')
  assert.equal(quoted.requiresQuote, true)
  assert.equal(quoted.cost, 0)
  assert.equal(quoted.landedCost, null)
})

test('il Brasile non ha alcuna linea DDP: resta in preventivo anche girando la politica', () => {
  // Non e' prudenza: il 21/09/2026 l'account non ha nessun servizio DDP verso BR,
  // quindi il modello landed-cost non e' costruibile. E non si ripiega sul DAP:
  // la pipeline di spedizione blocca (customs.json, ddp: true) un pacco DAP,
  // quindi un ordine BR incassato oggi non sarebbe spedibile.
  assert.equal(DDP_CAPABLE_CARRIER.BR, undefined)
  assert.equal(DESTINATION_TAX_RULES.BR, undefined)
  assert.equal(uncalibratedExtraEuProfile('BR'), null)
  assert.equal(shippingRequiresQuote('BR'), true)
  assert.equal(shippingRequiresQuote('BR', 'destination_profile'), true)
  assert.equal(calculateShipping(99, 'BR', 'destination_profile').cost, 0)
  assert.equal(calculateShipping(99, 'BR', 'destination_profile').landedCost, null)
})

test('il profilo di un paese non misurato: trasporto DDP-capace e aliquota del paese di destinazione', () => {
  // Preventivi Packlink 21/09/2026, collo 40x40x10 / 2,0 kg. Tutte le linee piu'
  // economiche di questi paesi NON supportano il DDP (`ddp: None`): la loro
  // carrier non e' un'alternativa a parita' di servizio.
  const cheapestQuote = { NO: 17.97, CA: 33.04, AU: 37.84, JP: 57.44 } as const

  for (const [country, cheapest] of Object.entries(cheapestQuote)) {
    const profile = uncalibratedExtraEuProfile(country as keyof typeof cheapestQuote)
    assert.ok(profile, `${country}: manca il profilo`)
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

  // L'aliquota NON e' piu' l'8,1% svizzero esteso a tutti: e' quella del paese
  // di destinazione, e la fonte dice che e' una regola di legge, non una misura.
  const expectedVat: Record<string, number> = { GB: 0.20, NO: 0.25, CA: 0.15, AU: 0.10, JP: 0.10, US: 0 }

  for (const country of ['US', 'GB', 'NO', 'CA', 'AU', 'JP'] as const) {
    const profile = uncalibratedExtraEuProfile(country)
    assert.ok(profile)
    if (!profile) continue
    assert.equal(profile.importVatRate, expectedVat[country], `${country}: aliquota IVA non e' quella del paese`)
    assert.equal(profile.importVatRate, DESTINATION_TAX_RULES[country]?.importVatRate)
    // I parametri tecnici restano quelli misurati su CH: assunzione dichiarata.
    assert.equal(profile.fixedImportFee, DEFAULT_EXTRA_EU_PROFILE.fixedImportFee)
    assert.equal(profile.ddpFee, DEFAULT_EXTRA_EU_PROFILE.ddpFee)
    assert.equal(profile.handlingFee, DEFAULT_EXTRA_EU_PROFILE.handlingFee)
    assert.equal(profile.calibrated, false)
    assert.equal(profile.source.startsWith('prudenziale'), true)
    assert.ok(profile.source.includes('NON misurati'), `${country}: gli oneri import non sono misurati`)
    assert.ok(
      (DESTINATION_TAX_RULES[country]?.source.length ?? 0) > 40,
      `${country}: la regola non cita la sua fonte`,
    )

    const rate = calculateShipping(99, country)
    assert.equal(rate.requiresQuote, false)
    assert.ok(rate.landedCost)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.carrier, profile.carrier)
    assert.ok(rate.cost >= UNCALIBRATED_EXTRA_EU_FLOOR, `${country}: sotto il pavimento`)
    assert.ok(rate.cost >= rate.landedCost.estimatedCost)
  }
})

test('il pavimento di 48,00 EUR si applica DOPO il calcolo e solo ai paesi non misurati', () => {
  assert.equal(UNCALIBRATED_EXTRA_EU_FLOOR, 48.00)

  // Sotto il pavimento: si vende lo stesso, ma non sotto la rete di sicurezza.
  for (const [country, goods] of [['GB', 0], ['GB', 30], ['NO', 0], ['NO', 10]] as const) {
    const rate = calculateShipping(goods, country)
    assert.equal(rate.cost, UNCALIBRATED_EXTRA_EU_FLOOR, `${country} @ ${goods}: non e' al pavimento`)
    assert.ok(rate.landedCost)
    assert.ok(
      (rate.landedCost?.estimatedCost ?? 0) < UNCALIBRATED_EXTRA_EU_FLOOR,
      `${country} @ ${goods}: qui il costo sdoganato supera il pavimento`,
    )
  }

  // Sopra il pavimento: si addebita il costo sdoganato, non il pavimento.
  const gb = calculateShipping(150, 'GB')
  assert.equal(gb.cost, 69.10)
  assert.ok(gb.cost > UNCALIBRATED_EXTRA_EU_FLOOR)

  // I paesi MISURATI non lo ricevono: una misura non si arrotonda a un prezzo.
  assert.equal(calculateShipping(99, 'CH').cost, 47.72)
  assert.ok(calculateShipping(99, 'CH').cost < UNCALIBRATED_EXTRA_EU_FLOOR)
  assert.equal(calculateShipping(0, 'CH').cost, 35.70)
})

test('le aliquote applicate sono quelle del paese: IVA all\'import dove esiste, dazio dove serve', () => {
  // GB: IVA 20% su merce + trasporto REALE (99,00 + 18,50) = 23,50. Con l'8,1%
  // svizzero sarebbero 9,52: ~14 EUR di perdita per spedizione, sotto DDP.
  const gb = calculateShipping(99, 'GB').landedCost
  assert.ok(gb)
  assert.equal(gb?.importVat, 23.50)
  assert.equal(gb?.duty, 0)

  // NO: MVA 25% su (99,00 + 23,99) = 30,75.
  assert.equal(calculateShipping(99, 'NO').landedCost?.importVat, 30.75)

  // CA: la provincia non e' nota al checkout -> si applica la MASSIMA HST (15%):
  // mai meno di quello che si paga davvero.
  assert.equal(calculateShipping(99, 'CA').landedCost?.importVat, 21.34)

  // AU e JP: 10% (GST / consumption tax).
  assert.equal(calculateShipping(99, 'AU').landedCost?.importVat, 16.35)
  assert.equal(calculateShipping(99, 'JP').landedCost?.importVat, 16.33)

  // US: nessuna IVA federale all'import, ma la franchise di 800 USD e' SOSPESA
  // dal 29/08/2025: oggi ogni spedizione paga dazio. Un profilo a dazio zero
  // qui vorrebbe dire vendere sotto costo su ogni ordine.
  for (const goods of [0, 99, 500]) {
    const us = calculateShipping(goods, 'US').landedCost
    assert.ok(us)
    assert.equal(us?.importVat, 0)
    assert.ok((us?.duty ?? 0) > 0, `US @ ${goods}: dazio a zero con la de minimis sospesa`)
  }
  assert.equal(calculateShipping(99, 'US').landedCost?.duty, 20.49) // 15% di (99,00 + 37,60)
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

/*
 * GB — la soglia di £135 e la fascia di dazio sopra soglia.
 *
 * Il dazio 0 nella fascia che lo storefront vende NON viene dalla dichiarazione
 * di origine UE: quella non viaggia con la fattura doganale e non e' aggiungibile
 * (verifica in sola lettura del 21/09/2026, t_73bfca79 — nel PDF reale
 * dell'ordine 31 c'e' la colonna `Country of origin: IT`, non la formula di
 * origine preferenziale, e il contratto della fattura doganale Packlink non ha un
 * campo dove scriverla). Viene dal relief «goods of negligible value»: sotto £135
 * di valore intrinseco della merce il dazio UK e' azzerato per legge, ed e' la
 * fascia in cui vendiamo. Sopra la soglia si applica la tariffa UKGT, che in DDP
 * paghiamo noi.
 */

test('GB: la fascia sopra soglia e\' ancorata alla soglia di £135 e alle aliquote di tariffa', () => {
  const rule = DESTINATION_TAX_RULES.GB
  assert.ok(rule, 'GB: manca la regola fiscale')
  if (!rule) return

  // Sotto la soglia l'aliquota applicata e' zero: la ragione sta nella fascia.
  assert.equal(rule.dutyRate, 0)
  assert.ok(
    !rule.source.includes('(TCA)'),
    'la motivazione del dazio 0 non e\' piu\' il TCA: la dichiarazione di origine non viaggia',
  )
  assert.ok(rule.source.includes('relief'), 'il profilo GB deve dire che il dazio 0 e\' il relief')
  assert.ok(rule.source.includes('Import Duty'), 'il profilo GB non cita il documento del relief')
  assert.ok(rule.source.includes('t_73bfca79'), 'il profilo GB non cita la verifica che ha chiuso il TCA')

  const band = rule.dutyAboveThreshold
  assert.ok(band, 'GB: manca la fascia sopra soglia: sopra £135 il dazio e\' a carico nostro (DDP)')
  if (!band) return

  // La soglia e' nella valuta della legge, e il confronto si fa li'.
  assert.equal(band.thresholdForeign, 135)
  assert.equal(band.currency, 'GBP')
  assert.equal(band.foreignPerEur, GBP_PER_EUR)

  // 39,62% pelle × 2,00% + 60,38% resina × 6,00% = 4,4152%, in eccesso a 4,42%.
  const blend = 0.3962 * 0.02 + 0.6038 * 0.06
  assert.equal(blend.toFixed(4), '0.0442')
  assert.equal(band.dutyRate, 0.0442)
  assert.ok(band.dutyRate >= blend, 'l\'aliquota di fascia non puo\' stare sotto il blend misurato')
  assert.ok(band.dutyRate < 0.06, 'la fascia e\' il blend, non la resina pura')

  // Le fonti della fascia: il relief, le due aliquote di tariffa, il cambio, e la
  // nota obbligatoria sulla rimozione del relief.
  const needles = [
    'Reliefs from Import Duty',
    'Section 5',
    'negligible value',
    '£135',
    '3926909790',
    '4016999790',
    '4,42%',
    '0,8588',
  ]
  for (const needle of needles) {
    assert.ok(band.source.includes(needle), `la fascia GB non cita «${needle}»`)
  }
  assert.ok(
    band.source.includes('October 2028'),
    'manca la nota sulla rimozione del relief LVI (nuove regole obbligatorie entro ottobre 2028)',
  )

  // Il profilo venduto eredita la fascia dalla regola di legge: e' la stessa.
  assert.equal(uncalibratedExtraEuProfile('GB')?.dutyAboveThreshold?.thresholdForeign, 135)
  assert.equal(uncalibratedExtraEuProfile('GB')?.dutyAboveThreshold?.dutyRate, 0.0442)
})

test('GB: sotto £135 di valore merce il dazio e\' zero, sopra entra nel totale', () => {
  // Il confine e' in GBP, al cambio dichiarato: 135 / 0,8588 = 157,1961 EUR di
  // merce. La norma dice «must not exceed £135», quindi la soglia e' inclusa.
  const justUnder = 157.19 // 157,19 × 0,8588 = 134,9948 GBP → esente
  const justOver = 157.20 // 157,20 × 0,8588 = 135,0034 GBP → sopra soglia
  assert.equal(Math.round((135 / GBP_PER_EUR) * 100) / 100, 157.20)

  for (const goods of [0, 30, 99, 150, justUnder]) {
    const landed = calculateShipping(goods, 'GB').landedCost
    assert.ok(landed, `merce ${goods}: manca la scomposizione`)
    assert.equal(landed?.duty, 0, `merce ${goods}: sotto soglia il dazio e' azzerato dal relief`)
    assert.equal(landed?.dutyBand, 'relief', `merce ${goods}: la fascia che ha deciso non e' il relief`)
  }

  const above = calculateShipping(justOver, 'GB')
  const landed = above.landedCost
  assert.ok(landed, 'merce sopra soglia: manca la scomposizione')
  if (!landed) return
  assert.equal(landed.dutyBand, 'above')
  // 4,42% della base doganale (157,20 + 18,50) = 7,77.
  assert.equal(landed.duty, 7.77)
  // Il dazio entra nel costo sdoganato e in quello addebitato, voce per voce:
  // 18,50 corriere + 6,35 assicurazione + 7,77 dazio + 35,14 IVA 20% di 175,70
  // + 4,89 sdoganamento + 4,96 fee DDP + 0,99 gestione = 78,60.
  assert.equal(landed.estimatedCost, 78.60)
  assert.equal(above.cost, 78.60)
  assert.equal(landed.total, 78.60)
  // Lo stesso carrello senza dazio costerebbe 70,83: la differenza e' il dazio.
  assert.equal(Math.round((landed.estimatedCost - 70.83) * 100) / 100, 7.77)

  // Sopra soglia il dazio cresce col valore: a merce 200 sono 9,66 (4,42% di 218,50).
  assert.equal(calculateShipping(200, 'GB').landedCost?.duty, 9.66)
})

test('GB: la soglia si confronta sul valore merce, non sulla base doganale', () => {
  // Merce 140,00 = 120,23 GBP (sotto la soglia) + trasporto 18,50 = 158,50 di
  // base doganale, cioe' 136,12 GBP: sopra soglia. Se il confronto fosse sulla
  // base doganale, qui scatterebbe un dazio che la norma non chiede — la soglia
  // e' sull'intrinsic value della merce, trasporto e assicurazione esclusi.
  const goods = 140
  assert.ok(goods * GBP_PER_EUR < 135, 'la merce deve stare sotto la soglia')
  assert.ok((goods + 18.50) * GBP_PER_EUR > 135, 'la base doganale deve stare sopra la soglia')

  const landed = calculateShipping(goods, 'GB').landedCost
  assert.ok(landed)
  assert.equal(landed?.duty, 0)
  assert.equal(landed?.dutyBand, 'relief')
})

test('GB: la fascia sopra soglia non tocca gli altri paesi ne\' l\'aliquota piatta', () => {
  for (const country of ['NO', 'CA', 'AU', 'JP', 'US'] as const) {
    assert.equal(
      DESTINATION_TAX_RULES[country]?.dutyAboveThreshold,
      undefined,
      `${country}: ha una fascia di dazio che non gli appartiene`,
    )
    assert.equal(
      uncalibratedExtraEuProfile(country)?.dutyAboveThreshold,
      undefined,
      `${country}: il profilo si porta dietro la fascia di un altro paese`,
    )
  }
  assert.equal(SWITZERLAND_PROFILE.dutyAboveThreshold, undefined)
  assert.equal(
    DEFAULT_EXTRA_EU_PROFILE.dutyAboveThreshold,
    undefined,
    'la fascia non e\' un parametro tecnico condiviso: e\' una soglia di legge per paese',
  )

  // US: aliquota piatta piena (la de minimis e' sospesa), nessuna soglia.
  assert.equal(calculateShipping(99, 'US').landedCost?.duty, 20.49)
  assert.equal(calculateShipping(99, 'US').landedCost?.dutyBand, 'flat')
  assert.equal(calculateShipping(2500, 'US').landedCost?.dutyBand, 'flat')

  // CH: misurato e senza fascia — dazio 0 per esenzione di capitolo, non per soglia.
  assert.equal(calculateShipping(99, 'CH').landedCost?.duty, 0)
  assert.equal(calculateShipping(2500, 'CH').landedCost?.dutyBand, 'flat')
})
