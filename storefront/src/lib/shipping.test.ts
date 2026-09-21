import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  DDP_CAPABLE_CARRIER,
  DEFAULT_EXTRA_EU_PROFILE,
  DESTINATION_TAX_RULES,
  EXTRA_EU_MARGIN_RATE,
  EXTRA_EU_MINIMUM_SHIPPING,
  GBP_PER_EUR,
  LANDED_COST_COUNTRIES,
  SWITZERLAND_PROFILE,
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
 * Il prezzo addebitato e' il COSTO + il margine deciso da Alessandro (10%): 52,49.
 */
const MEASURED_ORDER = { goods: 99, total: 47.72, importVat: 9.88, importFee: 4.89, charged: 52.49 }

/**
 * Prezzo addebitato sul carrello misurato (merce 99,00), paese per paese.
 *
 * Ogni numero qui e' calcolato a mano dalla politica — non letto dal modulo — e
 * serve a fissare il PUNTO DI PREZZO, non solo la coerenza interna: costo
 * sdoganato + 10% di margine, poi il pavimento di 48,00 EUR se sotto.
 * BR non compare: non ha una linea DDP, quindi si quota (test dedicato).
 */
const CHARGED_AT_99: Record<string, number> = {
  CH: 52.49, // 47,72 + 4,77
  GB: 63.83, // 58,03 + 5,80: IVA 20% su 99+19,49, dazio 0 perche' sotto £135
  NO: 76.54, // 69,58 + 6,96: MVA 25% su 99+23,99
  US: 99.37, // 90,34 + 9,03: nessuna IVA import, dazio 15% su 99+52,74
  CA: 87.41, // 79,46 + 7,95: HST massima 15% su 99+43,28
  AU: 105.30, // 95,73 + 9,57: GST 10% su 99+64,54
  JP: 105.05, // 95,50 + 9,55: consumption tax 10% su 99+64,33
}

const EXTRA_EU_COUNTRIES = ['CH', 'GB', 'NO', 'US', 'CA', 'AU', 'JP'] as const

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

test('l\'ordine misurato viene ricostruito al centesimo (costo), e addebitato col margine deciso', () => {
  const rate = calculateShipping(MEASURED_ORDER.goods, 'CH')

  assert.equal(rate.zone, 'EXTRA_EU')
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
  // Il COSTO misurato resta 47,72: e' l'asserzione di calibrazione.
  assert.equal(rate.landedCost.estimatedCost, MEASURED_ORDER.total)
  assert.equal(rate.landedCost.calibrated, true)
  assert.ok(rate.landedCost.source.includes('CMS 31'))

  // Ma il prezzo addebitato e' costo + margine: sono due numeri diversi.
  assert.equal(rate.landedCost.margin, 4.77)
  assert.equal(rate.landedCost.total, MEASURED_ORDER.charged)
  assert.equal(rate.cost, MEASURED_ORDER.charged)
  assert.equal(rate.minimumChargeApplied, false, 'sul caso misurato vince la stima, non il pavimento')

  // La somma dei componenti e' il costo: nessuna voce invisibile.
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

test('il margine extra-UE e\' il 10% deciso da Alessandro, non 0', () => {
  assert.equal(EXTRA_EU_MARGIN_RATE, 0.10)
  assert.equal(SWITZERLAND_PROFILE.marginRate, EXTRA_EU_MARGIN_RATE)
  // Vale anche per i paesi non misurati: e' un punto di prezzo, non una
  // proprieta' del profilo calibrato.
  for (const country of EXTRA_EU_COUNTRIES) {
    const profile = country === 'CH' ? SWITZERLAND_PROFILE : uncalibratedExtraEuProfile(country)
    assert.ok(profile, `${country}: manca il profilo`)
    if (!profile) continue
    assert.equal(profile.marginRate, EXTRA_EU_MARGIN_RATE, `${country}: margine diverso da quello deciso`)
  }

  const landed = calculateLandedCost(MEASURED_ORDER.goods, SWITZERLAND_PROFILE)
  assert.equal(landed.estimatedCost, MEASURED_ORDER.total)
  assert.equal(landed.margin, 4.77)
  assert.equal(landed.total, MEASURED_ORDER.charged)
  // E la tariffa che finisce nella riga Stripe e' il prezzo, non il costo.
  assert.equal(calculateShipping(MEASURED_ORDER.goods, 'CH').cost, MEASURED_ORDER.charged)
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

  // Ancore esterne, due colonne: il COSTO e' quello calcolato in modo
  // indipendente sulla misura di Alfred (ipotesi «il valore assicurato segue la
  // merce»); il PREZZO e' quel costo + 10%, con il pavimento sotto.
  const anchors: Array<[number, number, number]> = [
    [30, 39.34, 48.00], // 43,27 stimati: sotto il pavimento, quindi 48,00
    [50, 41.77, 48.00], // 45,95 stimati: sotto il pavimento
    [99, 47.72, 52.49],
    [150, 53.91, 59.30],
    [200, 59.98, 65.98],
    [300, 72.12, 79.33],
    [500, 96.40, 106.04],
  ]
  for (const [goods, cost, price] of anchors) {
    const rate = calculateShipping(goods, 'CH')
    assert.equal(
      rate.landedCost?.estimatedCost,
      cost,
      `${goods} EUR di merce: il profilo non riproduce il costo calcolato dalla misura`,
    )
    assert.equal(rate.cost, price, `${goods} EUR di merce: prezzo addebitato (costo + 10%, pavimento sotto)`)
    // Il prezzo non sta mai sotto il costo stimato.
    assert.ok(rate.cost >= (rate.landedCost?.estimatedCost ?? 0))
  }
})

test('il prezzo per paese e\' quello dell\'IVA di destinazione (non l\'8,1% svizzero)', () => {
  for (const country of EXTRA_EU_COUNTRIES) {
    const rate = calculateShipping(MEASURED_ORDER.goods, country)
    assert.equal(rate.cost, CHARGED_AT_99[country], `${country}: prezzo addebitato`)
  }

  // Il punto tecnico: con l'IVA svizzera GB e NO resterebbero SOTTO costo. Il
  // confronto e' sul COSTO sdoganato, perche' e' li' che si perde.
  const landedCh = calculateLandedCost(99, SWITZERLAND_PROFILE)
  const landedGb = calculateLandedCost(99, uncalibratedExtraEuProfile('GB')!)
  const landedNo = calculateLandedCost(99, uncalibratedExtraEuProfile('NO')!)
  assert.equal(landedCh.estimatedCost, MEASURED_ORDER.total)
  assert.ok(landedGb.estimatedCost > landedCh.estimatedCost, 'GB non e\' piu\' caro della Svizzera')
  assert.ok(landedNo.estimatedCost > landedCh.estimatedCost, 'NO non e\' piu\' caro della Svizzera')

  // Con l'8,1% svizzero il costo di GB scenderebbe a 43,93 contro un prezzo di
  // 63,83: 19,90 EUR di scarto che l'aliquota sbagliata nasconderebbe.
  const gbAsSwiss = calculateLandedCost(99, { ...uncalibratedExtraEuProfile('GB')!, importVatRate: 0.081 })
  assert.equal(gbAsSwiss.estimatedCost, 43.93)
  assert.ok(
    gbAsSwiss.estimatedCost < landedGb.estimatedCost,
    'sotto l\'8,1% GB dovrebbe costare meno, non di piu\'',
  )
  assert.equal(Math.round((CHARGED_AT_99.GB - gbAsSwiss.estimatedCost) * 100) / 100, 19.90)
})

test('nessuna spedizione extra-UE parte sotto il costo stimato ne\' sotto il pavimento', () => {
  // Criteri di accettazione, su tutti i paesi extra-UE ammessi e su un intervallo
  // di valori merce (compresi carrelli minuscoli e molto grandi), con la politica
  // di default E con quella fail-closed.
  const values = [0, 1, 9.99, 25, 47.5, 99, 150, 249.99, 250, 400, 999.99, 2500, 10000]

  for (const policy of ['quote_required', 'conservative_profile'] as const) {
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
          assert.equal(rate.minimumCharge, null)
          continue
        }

        assert.ok(rate.landedCost, `${country} @ ${goods} [${policy}]: manca la scomposizione`)
        if (!rate.landedCost) continue
        assert.equal(rate.isFree, false, `${country} @ ${goods}: spedizione gratuita su extra-UE`)
        assert.ok(
          rate.cost >= rate.landedCost.estimatedCost,
          `${country} @ ${goods} [${policy}]: addebitato ${rate.cost} < costo stimato ${rate.landedCost.estimatedCost}`,
        )
        // Il pavimento e' la rete di sicurezza di OGNI destinazione extra-UE,
        // compresa quella misurata: e' una politica di prezzo, non una misura.
        assert.ok(
          rate.cost >= EXTRA_EU_MINIMUM_SHIPPING,
          `${country} @ ${goods} [${policy}]: ${rate.cost} sotto il pavimento ${EXTRA_EU_MINIMUM_SHIPPING}`,
        )
        assert.ok(rate.cost > 0, `${country} @ ${goods} [${policy}]: costo non addebitato`)
        // Il pavimento non puo' abbassare un prezzo, solo alzarlo.
        assert.equal(rate.minimumCharge, EXTRA_EU_MINIMUM_SHIPPING)
        if (rate.minimumChargeApplied) {
          assert.equal(
            rate.cost,
            EXTRA_EU_MINIMUM_SHIPPING,
            `${country} @ ${goods} [${policy}]: pavimento applicato a un importo diverso`,
          )
          assert.ok(rate.landedCost.total < EXTRA_EU_MINIMUM_SHIPPING)
        } else {
          assert.equal(
            rate.cost,
            rate.landedCost.total,
            `${country} @ ${goods} [${policy}]: il pavimento ha abbassato il prezzo`,
          )
        }
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
  // Decisione di Alessandro del 21/09/2026: niente quote_required come stato
  // definitivo per un paese che ha una linea DDP-capace. Il pavimento di
  // 48,00 EUR e il margine del 10% sono i punti di prezzo.
  assert.equal(UNCALIBRATED_EXTRA_EU_POLICY, 'conservative_profile')

  for (const country of ['US', 'GB', 'CA', 'AU', 'JP', 'NO'] as const) {
    const rate = calculateShipping(99, country)
    assert.equal(rate.zone, 'EXTRA_EU')
    assert.equal(rate.requiresQuote, false, `${country}: un paese senza misura si vende`)
    assert.ok(rate.landedCost, `${country}: manca la scomposizione`)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.calibrated, false, `${country}: resta non misurato, e lo dichiara`)
    assert.ok(rate.cost >= EXTRA_EU_MINIMUM_SHIPPING)
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
  assert.equal(quoted.minimumCharge, null)
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
  assert.equal(shippingRequiresQuote('BR', 'conservative_profile'), true)
  assert.equal(calculateShipping(99, 'BR', 'conservative_profile').cost, 0)
  assert.equal(calculateShipping(99, 'BR', 'conservative_profile').landedCost, null)
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

  // GB e US: il profilo usa il preventivo CORRENTE della linea DDP-capace, non il
  // costo pagato nel 2025. Col costo pagato (18,50 / 37,60) il prezzo starebbe
  // sotto il costo di oggi: su un carrello da 99,00 l'US perderebbe ~19 EUR.
  assert.equal(uncalibratedExtraEuProfile('GB')?.carrier, 19.49)
  assert.equal(uncalibratedExtraEuProfile('US')?.carrier, 52.74)

  // La fonte dichiarata e' leggibile a macchina e nomina il costo pagato accanto
  // al preventivo: la scelta e il numero piu' vecchio restano entrambi visibili.
  assert.ok(DDP_CAPABLE_CARRIER.GB?.source.includes('18,50'))
  assert.ok(DDP_CAPABLE_CARRIER.US?.source.includes('37,60'))

  // L'aliquota NON e' l'8,1% svizzero esteso a tutti: e' quella del paese di
  // destinazione, e la fonte dice che e' una regola di legge, non una misura.
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
    assert.equal(profile.fixedImportFee, MEASURED_ORDER.importFee)
    assert.equal(profile.calibrated, false)
    assert.equal(profile.source.startsWith('prudenziale'), true)
    // La fonte deve dichiarare sia la base dei parametri TECNICI (l'ordine
    // misurato in Svizzera) sia che le ALIQUOTE import non sono misurate nostre:
    // senza la prima, 4,89 / 4,96 / 0,99 / 4,04% comparirebbero come inventati.
    assert.ok(profile.source.includes('misurati su CH'), `${country}: la fonte non dichiara la base dei parametri tecnici`)
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
    assert.ok(rate.cost >= EXTRA_EU_MINIMUM_SHIPPING, `${country}: sotto il pavimento`)
    assert.ok(rate.cost >= rate.landedCost.estimatedCost)
  }
})

test('il pavimento di 48,00 EUR si applica DOPO il calcolo, a ogni destinazione extra-UE', () => {
  assert.equal(EXTRA_EU_MINIMUM_SHIPPING, 48.00)

  // Sotto il pavimento: si vende lo stesso, ma non sotto la rete di sicurezza.
  // Ogni coppia e' verificata a mano (stima + 10% < 48,00), non dedotta dal modulo.
  const underFloor = [
    ['GB', 0], ['GB', 30], ['NO', 0], ['CH', 0], ['CH', 10], ['CH', 30], ['CH', 50],
  ] as const
  for (const [country, goods] of underFloor) {
    const rate = calculateShipping(goods, country)
    assert.equal(rate.cost, EXTRA_EU_MINIMUM_SHIPPING, `${country} @ ${goods}: non e' al pavimento`)
    assert.equal(rate.minimumCharge, EXTRA_EU_MINIMUM_SHIPPING)
    assert.equal(rate.minimumChargeApplied, true, `${country} @ ${goods}: il pavimento non risulta applicato`)
    // Il pavimento alza la stima, non la abbassa.
    assert.ok(rate.landedCost, `${country} @ ${goods}: manca la scomposizione`)
    if (!rate.landedCost) continue
    assert.ok(
      rate.landedCost.estimatedCost < EXTRA_EU_MINIMUM_SHIPPING,
      `${country} @ ${goods}: qui il costo sdoganato supera il pavimento`,
    )
    assert.ok(rate.cost > rate.landedCost.estimatedCost)
  }

  // Sopra il pavimento: si addebita il costo sdoganato + margine, non il pavimento.
  const gb = calculateShipping(150, 'GB')
  assert.equal(gb.landedCost?.estimatedCost, 70.29)
  assert.equal(gb.cost, 77.32) // 70,29 + 7,03
  assert.ok(gb.cost > EXTRA_EU_MINIMUM_SHIPPING)
  assert.equal(gb.minimumChargeApplied, false)

  // Anche i paesi MISURATI lo ricevono: e' una politica di prezzo, non una
  // misura. Sul carrello piccolo la stima svizzera scende sotto il pavimento.
  assert.equal(calculateShipping(30, 'CH').cost, EXTRA_EU_MINIMUM_SHIPPING)
  assert.equal(calculateShipping(30, 'CH').minimumChargeApplied, true)
  // Sul caso misurato non cambia nulla: 52,49 > 48,00.
  assert.equal(calculateShipping(99, 'CH').cost, MEASURED_ORDER.charged)
  assert.equal(calculateShipping(99, 'CH').minimumChargeApplied, false)

  // Le zone senza dogana non hanno pavimento.
  assert.equal(calculateShipping(10, 'IT').minimumCharge, null)
  assert.equal(calculateShipping(10, 'DE').minimumCharge, null)
})

test('un codice paese non ammesso si quota, non si inventa un prezzo', () => {
  // Fail-closed: senza una linea DDP e senza una regola fiscale per quel paese
  // non esiste un costo sdoganato da stimare, quindi non si incassa. Il checkout
  // rifiuta comunque un paese non ammesso prima di arrivare qui.
  const rate = calculateShipping(99, 'ZZ')
  assert.equal(rate.zone, 'EXTRA_EU')
  assert.equal(rate.requiresQuote, true)
  assert.equal(rate.cost, 0)
  assert.equal(rate.landedCost, null)
  assert.equal(uncalibratedExtraEuProfile('ZZ' as never), null)

  // Il profilo di default resta esportato come base tecnica dei paesi non
  // misurati, e non e' calibrato.
  assert.equal(DEFAULT_EXTRA_EU_PROFILE.calibrated, false)
  assert.equal(DEFAULT_EXTRA_EU_PROFILE.fixedImportFee, MEASURED_ORDER.importFee)
})

test('le aliquote applicate sono quelle del paese: IVA all\'import dove esiste, dazio dove serve', () => {
  // GB: IVA 20% su merce + trasporto REALE (99,00 + 19,49) = 23,70. Con l'8,1%
  // svizzero sarebbero 9,60: ~14 EUR di perdita per spedizione, sotto DDP.
  const gb = calculateShipping(99, 'GB').landedCost
  assert.ok(gb)
  assert.equal(gb?.importVat, 23.70)
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
  assert.equal(calculateShipping(99, 'US').landedCost?.duty, 22.76) // 15% di (99,00 + 52,74)
})

test('un carrello non finito non diventa un prezzo NaN e il margine non puo\' essere negativo', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rate = calculateShipping(bad, 'CH')
    assert.ok(Number.isFinite(rate.cost), `${bad}: prezzo non finito`)
    // Senza merce restano il trasporto, gli oneri fissi e l'IVA minima:
    // 23,00 + 0,99 + 4,89 + 4,96 + 1,86 (8,1% su 23,00) = 35,70 di costo, +10%
    // = 39,27. Sotto il pavimento, quindi si addebitano 48,00.
    assert.equal(rate.landedCost?.estimatedCost, 35.70)
    assert.equal(rate.landedCost?.total, 39.27)
    assert.equal(rate.cost, EXTRA_EU_MINIMUM_SHIPPING)
  }

  // Nessuna configurazione puo' far partire una spedizione sotto costo.
  const greedy = calculateLandedCost(99, { ...SWITZERLAND_PROFILE, marginRate: -0.5 })
  assert.equal(greedy.estimatedCost, 47.72)
  assert.equal(greedy.total, 47.72)
  assert.equal(greedy.margin, 0)
})

test('un carrello negativo non produce una scomposizione negativa', () => {
  // La guardia `Math.max(0, ...)` sulla merce: senza di essa un carrello negativo
  // pagherebbe una spedizione negativa in ogni voce (IVA, assicurazione, dazio)
  // e il pavimento sarebbe l'unica cosa a salvarlo.
  for (const bad of [-0.01, -1, -50, -10000]) {
    const rate = calculateShipping(bad, 'CH')
    assert.ok(rate.landedCost, `${bad}: manca la scomposizione`)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.importVat, 1.86, `${bad}: IVA negativa o diversa da quella a merce zero`)
    assert.equal(rate.landedCost.insurance, 0, `${bad}: assicurazione negativa`)
    assert.equal(rate.landedCost.estimatedCost, 35.70, `${bad}: costo diverso da quello a merce zero`)
    assert.ok(rate.landedCost.duty >= 0, `${bad}: dazio negativo`)
    assert.equal(rate.cost, EXTRA_EU_MINIMUM_SHIPPING)
  }
})

test('una merce con frazioni di centesimo viene arrotondata al centesimo prima del calcolo', () => {
  // Il prezzo non deve dipendere da cifre oltre il centesimo: gli ingressi reali
  // sono centesimi, e un carrello con piu' decimali non deve produrre un totale
  // diverso da quello dello stesso carrello arrotondato.
  assert.equal(calculateShipping(10.004, 'CH').cost, calculateShipping(10, 'CH').cost)
  assert.equal(calculateShipping(10.006, 'CH').cost, calculateShipping(10.01, 'CH').cost)
  assert.equal(calculateShipping(99.001, 'CH').cost, calculateShipping(99, 'CH').cost)
  assert.equal(calculateShipping(99.005, 'CH').cost, calculateShipping(99.01, 'CH').cost)
  assert.equal(calculateShipping(99.999, 'CH').cost, calculateShipping(100, 'CH').cost)
  // E la merce arrotondata e' quella che compare nella scomposizione.
  const landed = calculateShipping(99.004, 'CH').landedCost
  assert.equal(landed?.insurance, 4.0) // 4,04% di 99,00
})

test('il profilo di un paese non misurato dichiara la base dei parametri tecnici', () => {
  // Riferimento CH: i parametri tecnici (4,89 / 4,96 / 0,99 / 4,04%) NON sono
  // inventati per il paese, sono misurati su un ordine DDP reale. La fonte emessa
  // deve dirlo, altrimenti l'unica riga che lo dichiara resta invisibile al
  // chiamante (era un'asserzione di main, persa nella riconciliazione).
  for (const country of ['GB', 'NO', 'US', 'CA', 'AU', 'JP'] as const) {
    const profile = uncalibratedExtraEuProfile(country)
    assert.ok(profile, `${country}: manca il profilo`)
    if (!profile) continue
    assert.ok(
      profile.source.includes('misurati su CH'),
      `${country}: la fonte non dichiara che i parametri tecnici vengono dalla misura CH`,
    )
    assert.equal(profile.fixedImportFee, 4.89)
  }
  // E non e' un profilo "prudente" usabile come ripiego: un paese senza linea DDP
  // non lo riceve, si quota.
  assert.equal(calculateShipping(99, 'ZZ').requiresQuote, true)
  assert.equal(calculateShipping(99, 'ZZ').landedCost, null)
})

test('Italia e Unione Europea restano come erano', () => {
  const italy = calculateShipping(49.99, 'IT')
  assert.equal(italy.zone, 'IT')
  assert.equal(italy.cost, 7.65)
  assert.equal(italy.landedCost, null)
  assert.equal(italy.freeAbove, 50)
  assert.equal(italy.minimumCharge, null)
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
  assert.equal(SWITZERLAND_PROFILE.marginRate, EXTRA_EU_MARGIN_RATE)
  assert.equal(SWITZERLAND_PROFILE.freeShippingPromoAllowed, false)
  // LANDED_COST_COUNTRIES e' la tabella dei profili MISURATI: per gli altri paesi
  // il profilo lo costruisce `uncalibratedExtraEuProfile`.
  assert.equal(LANDED_COST_COUNTRIES.CH, SWITZERLAND_PROFILE)
  assert.equal(Object.keys(LANDED_COST_COUNTRIES).length, 1, 'un profilo qui dentro e\' una misura, non una stima')
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
  // La clausola OPERATIVA, non una parola qualunque: 'relief' da solo compare
  // anche nella nota sulla rimozione, quindi attribuire il dazio zero al TCA
  // lascerebbe questa asserzione verde. Qui si pretende la frase che lo attribuisce
  // al relief di §5.
  assert.ok(
    rule.source.includes('per il relief di §5'),
    'il profilo GB non attribuisce il dazio 0 al relief di §5',
  )
  assert.ok(
    !rule.source.includes('(TCA)'),
    'la motivazione del dazio 0 non e\' piu\' il TCA: la dichiarazione di origine non viaggia',
  )
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
  // 4,42% della base doganale (157,20 + 19,49) = 7,81.
  assert.equal(landed.duty, 7.81)
  // Il dazio entra nel costo sdoganato, voce per voce: 19,49 corriere + 6,35
  // assicurazione + 7,81 dazio + 36,90 IVA 20% di (157,20 + 19,49 + 7,81 = 184,50)
  // + 4,89 sdoganamento + 4,96 fee DDP + 0,99 gestione = 81,39.
  assert.equal(landed.estimatedCost, 81.39)
  // Poi il margine deciso da Alessandro (10%): 8,14, quindi 89,53 addebitati.
  assert.equal(landed.margin, 8.14)
  assert.equal(landed.total, 89.53)
  assert.equal(above.cost, 89.53)
  // Lo stesso carrello senza dazio costerebbe 72,02: la differenza e' 9,37, cioe'
  // il dazio 7,81 piu' l'IVA che il dazio stesso genera (20% di 7,81 = 1,56).
  // La base dell'IVA include il dazio: se non lo includesse, l'IVA dovuta
  // sarebbe sottostimata di 1,56 su questo carrello.
  const withoutDuty = calculateLandedCost(justOver, {
    ...uncalibratedExtraEuProfile('GB')!,
    dutyAboveThreshold: undefined,
    dutyRate: 0,
  })
  assert.equal(withoutDuty.estimatedCost, 72.02)
  assert.equal(Math.round((landed.estimatedCost - withoutDuty.estimatedCost) * 100) / 100, 9.37)
  assert.equal(
    Math.round((landed.importVat - withoutDuty.importVat) * 100) / 100,
    1.56,
    'l\'IVA non sta pagando anche il dazio: la base non lo include',
  )

  // Sopra soglia il dazio cresce col valore: a merce 200 sono 9,70 (4,42% di 219,49).
  assert.equal(calculateShipping(200, 'GB').landedCost?.duty, 9.70)
  assert.equal(calculateShipping(200, 'GB').landedCost?.estimatedCost, 93.95)
  assert.equal(calculateShipping(200, 'GB').cost, 103.35)
})

test('GB: la soglia si confronta sul valore merce, non sulla base doganale', () => {
  // Merce 140,00 = 120,23 GBP (sotto la soglia) + trasporto 18,50 = 158,50 di
  // base doganale, cioe' 136,12 GBP: sopra soglia. Se il confronto fosse sulla
  // base doganale, qui scatterebbe un dazio che la norma non chiede — la soglia
  // e' sull'intrinsic value della merce, trasporto e assicurazione esclusi.
  const goods = 140
  assert.ok(goods * GBP_PER_EUR < 135, 'la merce deve stare sotto la soglia')
  assert.ok((goods + 19.49) * GBP_PER_EUR > 135, 'la base doganale deve stare sopra la soglia')

  const landed = calculateShipping(goods, 'GB').landedCost
  assert.ok(landed)
  assert.equal(landed?.duty, 0)
  assert.equal(landed?.dutyBand, 'relief')
  assert.equal(landed?.estimatedCost, 67.89)
  assert.equal(calculateShipping(goods, 'GB').cost, 74.68) // 67,89 + 6,79
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
  assert.equal(calculateShipping(99, 'US').landedCost?.duty, 22.76)
  assert.equal(calculateShipping(99, 'US').landedCost?.dutyBand, 'flat')
  assert.equal(calculateShipping(2500, 'US').landedCost?.dutyBand, 'flat')

  // CH: misurato e senza fascia — dazio 0 per esenzione di capitolo, non per soglia.
  assert.equal(calculateShipping(99, 'CH').landedCost?.duty, 0)
  assert.equal(calculateShipping(2500, 'CH').landedCost?.dutyBand, 'flat')
})
