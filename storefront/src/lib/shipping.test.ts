import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  DEFAULT_EXTRA_EU_PROFILE,
  EXTRA_EU_MARGIN_RATE,
  EXTRA_EU_MINIMUM_SHIPPING,
  LANDED_COST_COUNTRIES,
  SWITZERLAND_PROFILE,
  calculateLandedCost,
  calculateShipping,
  freeShippingRemaining,
  getShippingZone,
  isFreeShippingPromoAllowed,
  shippingRequiresQuote,
} from './shipping'

/**
 * Il caso che ha aperto il problema, nudo e crudo: ordine CMS 31 / Basel CH,
 * merce 99,00 EUR, collo 40x40x10 / 2,0 kg.
 *   corriere 23,00 + gestione 0,99 + assicurazione 4,00 + dogana 14,77 + DDP 4,96
 *   = 47,72 EUR di COSTO reale, contro 14,99 EUR incassati.
 *
 * Costo e prezzo sono due cose diverse: il costo misurato e' 47,72, il prezzo
 * addebitato e' 52,49 (costo + margine 10% deciso da Alessandro il 21/09/2026).
 */
const MEASURED_ORDER = { goods: 99, cost: 47.72, charged: 52.49 }

/**
 * Prezzi attesi a 99,00 EUR di merce (collo di riferimento, margine 10%) per i
 * paesi extra-UE vendibili. Le aliquote IVA sono quelle della destinazione:
 *   CH 8,1% · GB 20% · NO 25% · US 0% (nessuna IVA import sotto 800 USD)
 *   CA 13% (GST/HST) · AU 10% · JP 10% · BR 25%
 * US e' l'unico sotto il pavimento: costo stimato 40,73 → si addebita 48,00.
 */
const EXPECTED_CHARGE_AT_99: Record<string, number> = {
  CH: 52.49,
  GB: 69.76,
  NO: 77.02,
  US: 48.00,
  CA: 59.60,
  AU: 55.25,
  JP: 55.25,
  BR: 77.02,
}

const EXTRA_EU_COUNTRIES = ['CH', 'GB', 'NO', 'US', 'CA', 'AU', 'JP', 'BR'] as const

test('la Svizzera e la Norvegia sono extra-UE, non Europa: e\' la causa della perdita', () => {
  // Il difetto originale: il confine era continentale, non doganale.
  assert.equal(getShippingZone('CH'), 'EXTRA_EU')
  assert.equal(getShippingZone('NO'), 'EXTRA_EU')
  assert.equal(getShippingZone('GB'), 'EXTRA_EU')
  assert.equal(getShippingZone('US'), 'EXTRA_EU')
  assert.equal(getShippingZone('ch'), 'EXTRA_EU', 'le maiuscole non devono cambiare la zona')
  // Nessun cambiamento per chi e\' nel territorio doganale.
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
  // 8,1% su (99,00 + 23,00 + 4,00 + 0,99 + 4,96) = 10,69
  assert.equal(rate.landedCost.importVat, 10.69)
  // Il residuo dei customs_and_duties che l'IVA non spiega: 14,77 − 10,69.
  assert.equal(rate.landedCost.fixedImportFee, 4.08)
  // Il COSTO misurato resta 47,72: e' l'asserzione di calibrazione.
  assert.equal(rate.landedCost.estimatedCost, MEASURED_ORDER.cost)
  assert.equal(rate.landedCost.calibrated, true)
  assert.ok(rate.landedCost.source.includes('CMS 31'))
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
    MEASURED_ORDER.cost,
  )
})

test('il margine extra-UE e\' il 10% deciso da Alessandro, non 0', () => {
  assert.equal(EXTRA_EU_MARGIN_RATE, 0.10)
  assert.equal(SWITZERLAND_PROFILE.marginRate, 0.10)
  for (const country of EXTRA_EU_COUNTRIES) {
    assert.equal(LANDED_COST_COUNTRIES[country]?.marginRate, 0.10, `${country}: margine diverso da quello deciso`)
  }

  const landed = calculateLandedCost(MEASURED_ORDER.goods, SWITZERLAND_PROFILE)
  // Costo e prezzo sono due numeri diversi e servono due asserzioni.
  assert.equal(landed.estimatedCost, MEASURED_ORDER.cost)
  assert.equal(landed.margin, 4.77)
  assert.equal(landed.total, MEASURED_ORDER.charged)
  // E la tariffa che finisce nella riga Stripe e' il prezzo, non il costo.
  assert.equal(calculateShipping(MEASURED_ORDER.goods, 'CH').cost, MEASURED_ORDER.charged)
})

test('paesi extra-UE non misurati: si vendono col profilo prudenziale del paese e l\'IVA di destinazione', () => {
  assert.notEqual(LANDED_COST_COUNTRIES.CH, undefined)
  for (const country of EXTRA_EU_COUNTRIES) {
    const profile = LANDED_COST_COUNTRIES[country]
    assert.ok(profile, `${country}: destinazione ammessa senza profilo`)
    if (!profile) continue

    if (country === 'CH') {
      // L'unico misurato.
      assert.equal(profile.calibrated, true)
      continue
    }
    // Tutti gli altri: prudenziali e dichiarati tali, mai spacciati per misure.
    assert.equal(profile.calibrated, false, `${country}: profilo non dichiarato prudenziale`)
    assert.ok(profile.source.startsWith('prudenziale'), `${country}: fonte non dichiarata`)
    assert.ok(profile.source.includes('riferimento CH'), `${country}: base del profilo non dichiarata`)
    // Nessuna destinazione vendibile puo' restare senza prezzo.
    assert.equal(shippingRequiresQuote(country), false, `${country}: non vendibile con la politica di default`)
    assert.equal(calculateShipping(99, country).requiresQuote, false)
  }
})

test('il prezzo per paese e\' quello dell\'IVA di destinazione (non l\'8,1% svizzero)', () => {
  for (const country of EXTRA_EU_COUNTRIES) {
    const rate = calculateShipping(MEASURED_ORDER.goods, country)
    assert.equal(rate.cost, EXPECTED_CHARGE_AT_99[country], `${country}: prezzo addebitato`)
  }

  // Il punto tecnico: con l'IVA svizzera GB e NO resterebbero SOTTO costo, e il
  // pavimento di 48,00 non li salverebbe (sarebbero 52,49 addebitati contro
  // 63,42 e 70,02 di costo stimato).
  const chVat = SWITZERLAND_PROFILE.importVatRate
  const gb = LANDED_COST_COUNTRIES.GB
  const no = LANDED_COST_COUNTRIES.NO
  assert.ok(gb)
  assert.ok(no)
  if (!gb || !no) return

  const gbAsSwiss = calculateLandedCost(99, { ...gb, importVatRate: chVat })
  const noAsSwiss = calculateLandedCost(99, { ...no, importVatRate: chVat })
  assert.equal(gbAsSwiss.total, MEASURED_ORDER.charged)
  assert.equal(noAsSwiss.total, MEASURED_ORDER.charged)

  // Sotto costo rispettivamente di 17,27 e 24,53 EUR sul prezzo addebitato.
  assert.equal(Math.round((EXPECTED_CHARGE_AT_99.GB - gbAsSwiss.total) * 100) / 100, 17.27)
  assert.equal(Math.round((EXPECTED_CHARGE_AT_99.NO - noAsSwiss.total) * 100) / 100, 24.53)

  // GB e NO stanno sopra il pavimento per costruzione, non per effetto del
  // pavimento; US e' l'unico che il pavimento solleva.
  assert.ok(calculateLandedCost(99, gb).total > EXTRA_EU_MINIMUM_SHIPPING)
  assert.ok(calculateLandedCost(99, no).total > EXTRA_EU_MINIMUM_SHIPPING)
  assert.ok(calculateLandedCost(99, LANDED_COST_COUNTRIES.US!).total < EXTRA_EU_MINIMUM_SHIPPING)
  assert.equal(calculateShipping(99, 'US').minimumChargeApplied, true)
  assert.equal(calculateShipping(99, 'GB').minimumChargeApplied, false)
  assert.equal(calculateShipping(99, 'NO').minimumChargeApplied, false)
})

test('nessuna spedizione extra-UE parte sotto il costo sdoganato stimato ne\' sotto il pavimento', () => {
  // Criteri di accettazione: mai sotto costo, mai sotto 48,00 EUR addebitati.
  const values = [0, 1, 9.99, 25, 47.5, 60, 99, 150, 249.99, 250, 400, 999.99, 2500, 10000]

  for (const country of ALLOWED_SHIPPING_COUNTRIES) {
    if (getShippingZone(country) !== 'EXTRA_EU') continue
    for (const goods of values) {
      const rate = calculateShipping(goods, country)

      assert.equal(rate.requiresQuote, false, `${country} @ ${goods}: non vendibile con la politica di default`)
      assert.ok(rate.landedCost, `${country} @ ${goods}: manca la scomposizione`)
      if (!rate.landedCost) continue
      assert.equal(rate.isFree, false, `${country} @ ${goods}: spedizione gratuita su extra-UE`)
      assert.ok(
        rate.cost >= rate.landedCost.estimatedCost,
        `${country} @ ${goods}: addebitato ${rate.cost} < costo stimato ${rate.landedCost.estimatedCost}`,
      )
      assert.ok(
        rate.cost >= EXTRA_EU_MINIMUM_SHIPPING,
        `${country} @ ${goods}: addebitato ${rate.cost} < pavimento ${EXTRA_EU_MINIMUM_SHIPPING}`,
      )
      assert.ok(rate.cost > 0, `${country} @ ${goods}: costo non addebitato`)
      // Il pavimento non puo' abbassare un prezzo, solo alzarlo.
      if (rate.minimumChargeApplied) {
        assert.equal(rate.cost, EXTRA_EU_MINIMUM_SHIPPING, `${country} @ ${goods}: pavimento applicato a un importo diverso`)
        assert.ok(rate.landedCost.total < EXTRA_EU_MINIMUM_SHIPPING)
      } else {
        assert.equal(rate.cost, rate.landedCost.total, `${country} @ ${goods}: il pavimento ha abbassato il prezzo`)
      }
      // Il costo e' un importo in centesimi: niente frazioni di centesimo.
      assert.equal(Number.isInteger(Math.round(rate.cost * 100)), true)
      assert.equal(Math.round(rate.cost * 100) / 100, rate.cost)
    }
  }
})

test('il pavimento si applica a ogni destinazione extra-UE, anche a quella misurata', () => {
  assert.equal(EXTRA_EU_MINIMUM_SHIPPING, 48.00)
  // Sotto ~50 EUR di merce la stima svizzera scende sotto il pavimento: vince
  // il pavimento (e' una politica di prezzo, non una misura). Sul caso
  // misurato non cambia nulla: 52,49 > 48,00.
  const small = calculateShipping(10, 'CH')
  assert.equal(small.minimumCharge, EXTRA_EU_MINIMUM_SHIPPING)
  assert.equal(small.minimumChargeApplied, true)
  assert.equal(small.cost, 48.00)
  assert.ok(small.cost >= small.landedCost!.estimatedCost)
  assert.equal(calculateShipping(99, 'CH').minimumChargeApplied, false)
  assert.equal(calculateShipping(99, 'CH').cost, 52.49)
  // Le zone senza dogana non hanno pavimento.
  assert.equal(calculateShipping(10, 'IT').minimumCharge, null)
  assert.equal(calculateShipping(10, 'DE').minimumCharge, null)
  assert.equal(calculateShipping(10, 'DE').cost, 14.99)
})

test('con la politica fail-closed le destinazioni non misurate tornano a quotarsi', () => {
  // Rete di sicurezza: si attiva con una riga e non spedisce affatto.
  for (const country of ['US', 'GB', 'CA', 'AU', 'JP', 'BR', 'NO'] as const) {
    const rate = calculateShipping(99, country, 'quote_required')
    assert.equal(rate.zone, 'EXTRA_EU')
    assert.equal(rate.requiresQuote, true, `${country}: venduto con un prezzo non misurato`)
    assert.equal(rate.cost, 0)
    assert.equal(rate.landedCost, null)
    assert.equal(rate.minimumCharge, null)
    assert.equal(shippingRequiresQuote(country, 'quote_required'), true)
  }

  // La Svizzera e' misurata: la politica non la tocca.
  assert.equal(shippingRequiresQuote('CH', 'quote_required'), false)
  assert.equal(calculateShipping(99, 'CH', 'quote_required').cost, 52.49)
  assert.equal(shippingRequiresQuote('IT'), false)
  assert.equal(shippingRequiresQuote('DE'), false)
})

test('un codice paese non vendibile non puo\' comunque stare sotto il pavimento', () => {
  // Fallback: il profilo piu' prudente disponibile. Non e' una destinazione
  // ammessa (il checkout la rifiuta prima), ma un errore di configurazione non
  // deve diventare una spedizione sotto costo.
  const rate = calculateShipping(99, 'ZZ')
  assert.equal(rate.zone, 'EXTRA_EU')
  assert.ok(rate.cost >= EXTRA_EU_MINIMUM_SHIPPING)
  assert.ok(rate.landedCost)
  assert.equal(rate.landedCost?.calibrated, false)
  const rates = EXTRA_EU_COUNTRIES.map((c) => LANDED_COST_COUNTRIES[c]!.importVatRate)
  assert.equal(DEFAULT_EXTRA_EU_PROFILE.importVatRate, Math.max(...rates), 'il fallback non e\' il piu\' prudente')
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

test('un carrello non finito non diventa un prezzo NaN e il margine non puo\' essere negativo', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rate = calculateShipping(bad, 'CH')
    assert.ok(Number.isFinite(rate.cost), `${bad}: prezzo non finito`)
    // Senza merce la stima e' 35,37 (23,00 + 0,99 + 4,08 + 4,96 + 2,34 di IVA
    // su 28,95) + 10% = 38,91: sotto il pavimento, quindi si addebitano 48,00.
    assert.equal(rate.cost, EXTRA_EU_MINIMUM_SHIPPING)
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
  assert.equal(SWITZERLAND_PROFILE.marginRate, 0.10)
  assert.equal(SWITZERLAND_PROFILE.freeShippingPromoAllowed, false)
})

test('la soglia di de minimis, se accesa, abbassa il costo senza scendere sotto il trasporto', () => {
  const exempt = calculateLandedCost(40, { ...SWITZERLAND_PROFILE, importVatExemptBelow: 500 })
  const taxed = calculateLandedCost(40, SWITZERLAND_PROFILE)
  assert.equal(exempt.importVat, 0)
  assert.ok(exempt.total < taxed.total)
  assert.ok(exempt.total >= exempt.carrier + exempt.ddpFee + exempt.handlingFee)
})
