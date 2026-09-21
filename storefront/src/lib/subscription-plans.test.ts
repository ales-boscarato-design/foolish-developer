import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SUBSCRIPTION_LADDER,
  ZONE_COUNTRIES,
  getBenefitForCycle,
  isActivatableDestination,
  type Zone,
} from './subscription-plans'
import { EU_CUSTOMS_UNION, getShippingZone } from './shipping'

/**
 * Decisione di Alessandro (21/09/2026): le nuove attivazioni dell'abbonamento
 * verso destinazioni extra-UE restano chiuse. La ragione e' un numero: un ciclo
 * verso CH addebita 14,99 EUR di spedizione contro un costo sdoganato stimato
 * di 40,99 (tattoo) / 43,79 (pmu), ogni mese.
 */
const EXTRA_EU_DESTINATIONS = ['CH', 'NO', 'IS', 'LI', 'GB', 'US', 'CA', 'AU', 'JP', 'BR'] as const

test('una nuova attivazione non puo\' aprire verso una destinazione extra-UE', () => {
  for (const country of EXTRA_EU_DESTINATIONS) {
    assert.equal(getShippingZone(country), 'EXTRA_EU', `${country}: non risulta extra-UE`)
    assert.equal(
      ZONE_COUNTRIES.EU.includes(country),
      false,
      `${country}: ammessa da shipping_address_collection del checkout abbonamento`,
    )
    assert.equal(isActivatableDestination('EU', country), false, `${country}: attivabile dalla zona EU`)
    assert.equal(isActivatableDestination('IT', country), false, `${country}: attivabile dalla zona IT`)
  }

  // Tutto quello che e' nel territorio doganale resta attivabile.
  for (const country of EU_CUSTOMS_UNION) {
    assert.equal(ZONE_COUNTRIES.EU.includes(country), true, `${country}: destinazione UE non attivabile`)
    assert.equal(isActivatableDestination('EU', country), true)
  }
  assert.deepEqual(ZONE_COUNTRIES.IT, ['IT'])
  assert.equal(isActivatableDestination('IT', 'IT'), true)
  assert.equal(isActivatableDestination('IT', 'DE'), false, 'la scala italiana non accetta indirizzi esteri')
  assert.equal(isActivatableDestination('EU', 'de'), true, 'il confronto non dipende dalle maiuscole')
})

test('ogni zona dell\'abbonamento accetta solo destinazioni della sua zona doganale', () => {
  for (const [zone, countries] of Object.entries(ZONE_COUNTRIES) as [Zone, string[]][]) {
    assert.ok(countries.length > 0, `${zone}: nessuna destinazione attivabile`)
    assert.equal(new Set(countries).size, countries.length, `${zone}: destinazioni duplicate`)
    for (const country of countries) {
      assert.match(country, /^[A-Z]{2}$/, `${zone}: codice paese non valido (${country})`)
      // Il ponte fra scala di prezzo e geografia: se la lista e il codice non
      // concordano, un cliente paga la tariffa di una zona che non e' la sua.
      assert.equal(getShippingZone(country), zone, `${zone}: ${country} non e' della zona doganale della scala`)
    }
  }
})

test('i rinnovi gia\' attivi non cambiano: la scala dell\'abbonamento resta quella di prima', () => {
  // Chi ha gia' un abbonamento verso CH continua a pagare la tariffa
  // contrattata: Alessandro decide caso per caso se e quando toccarla.
  assert.equal(getBenefitForCycle('tattoo', 'EU', 1).shippingPrice, 14.99)
  assert.equal(getBenefitForCycle('tattoo', 'EU', 1).total, 59.99)
  assert.equal(getBenefitForCycle('pmu', 'EU', 1).shippingPrice, 14.99)
  assert.equal(getBenefitForCycle('pmu', 'EU', 1).total, 82.49)
  for (const zone of ['IT', 'EU'] as const) {
    assert.equal(SUBSCRIPTION_LADDER.tattoo[zone].phases.length, 3)
    assert.equal(SUBSCRIPTION_LADDER.pmu[zone].phases.length, 3)
  }
})
