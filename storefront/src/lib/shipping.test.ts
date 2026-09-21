import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWED_SHIPPING_COUNTRIES,
  DEFAULT_EXTRA_EU_PROFILE,
  SWITZERLAND_PROFILE,
  UNCALIBRATED_EXTRA_EU_FLAT,
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
 *   = 47,72 EUR reali, contro 14,99 EUR incassati.
 */
const MEASURED_ORDER = { goods: 99, total: 47.72 }

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

test('l\'ordine misurato viene ricostruito al centesimo', () => {
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
  // 8,1% su (99,00 + 23,00 + 4,00 + 0,99 + 4,96) = 10,69
  assert.equal(rate.landedCost.importVat, 10.69)
  // Il residuo dei customs_and_duties che l'IVA non spiega: 14,77 − 10,69.
  assert.equal(rate.landedCost.fixedImportFee, 4.08)
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

test('nessuna spedizione extra-UE parte sotto il costo sdoganato stimato', () => {
  // Criterio di accettazione n.1, su tutti i paesi extra-UE ammessi e su un
  // intervallo di valori merce (compresi carrelli minuscoli e molto grandi).
  const values = [0, 1, 9.99, 25, 47.5, 99, 150, 249.99, 250, 400, 999.99, 2500, 10000]

  for (const country of ALLOWED_SHIPPING_COUNTRIES) {
    if (getShippingZone(country) !== 'EXTRA_EU') continue
    for (const goods of values) {
      const rate = calculateShipping(goods, country)

      // Paese senza misura: non si incassa nulla e non si inventa un prezzo.
      // (Se un giorno la politica diventa 'conservative_profile', il paese
      // ricade nel ramo sotto e deve reggere le stesse disuguaglianze.)
      if (rate.requiresQuote) {
        assert.equal(rate.cost, 0, `${country} @ ${goods}: un preventivo non incassa`)
        assert.equal(rate.landedCost, null, `${country} @ ${goods}: nessuna stima inventata`)
        assert.equal(rate.isFree, false)
        continue
      }

      assert.ok(rate.landedCost, `${country} @ ${goods}: manca la scomposizione`)
      if (!rate.landedCost) continue
      assert.equal(rate.isFree, false, `${country} @ ${goods}: spedizione gratuita su extra-UE`)
      assert.ok(
        rate.cost >= rate.landedCost.estimatedCost,
        `${country} @ ${goods}: addebitato ${rate.cost} < costo stimato ${rate.landedCost.estimatedCost}`,
      )
      assert.ok(rate.cost > 0, `${country} @ ${goods}: costo non addebitato`)
      // Il costo e' un importo in centesimi: niente frazioni di centesimo.
      assert.equal(Number.isInteger(Math.round(rate.cost * 100)), true)
      assert.equal(Math.round(rate.cost * 100) / 100, rate.cost)
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

  // Il profilo CH non e' prudente per tutti (IVA 20% in GB, 25% in NO; nessuna
  // IVA all'importazione negli USA sotto gli 800 USD): per questo non e' il
  // default. Se la politica viene girata di proposito, il pavimento storico
  // resta e la disuguaglianza col costo stimato regge comunque.
  for (const country of ['US', 'GB', 'NO'] as const) {
    const rate = calculateShipping(99, country, 'conservative_profile')
    assert.equal(rate.requiresQuote, false)
    assert.ok(rate.landedCost)
    if (!rate.landedCost) continue
    assert.equal(rate.landedCost.calibrated, false)
    assert.equal(rate.landedCost.source.startsWith('prudenziale'), true)
    assert.ok(rate.cost >= UNCALIBRATED_EXTRA_EU_FLAT)
    assert.ok(rate.cost >= calculateLandedCost(99, DEFAULT_EXTRA_EU_PROFILE).total)
    assert.ok(rate.cost >= rate.landedCost.estimatedCost)
  }
})

test('un carrello non finito non diventa un prezzo NaN e il margine non puo\' essere negativo', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const rate = calculateShipping(bad, 'CH')
    assert.ok(Number.isFinite(rate.cost), `${bad}: prezzo non finito`)
    // Senza merce restano gli oneri fissi e l'IVA minima: 23,00 + 0,99 +
    // 4,08 + 4,96 + 2,34 (8,1% su 28,95).
    assert.equal(rate.cost, 35.37)
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
