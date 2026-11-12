/**
 * Test della spedizione rivenditori: zone, soglie di gratuita e preventivo.
 *
 * Modulo puro: nessuna rete, nessun Next, nessun CMS. Gli importi sono quelli
 * della tariffa vera (7,65 IT / 14,99 EU, soglie 60 / 150) perche' qui il numero
 * E' la regola commerciale: se cambia, il test deve cambiare con una decisione,
 * non con un ritocco per far tornare il verde.
 *
 * Perche' esiste: fino al 12/11/2026 la soglia italiana del B2B era 50 mentre il
 * retail era a 60, e la nota nel modulo rimandava a «un test» che non c'era.
 * Questi confini (59,99 / 60,00 / 60,01 e 149,99 / 150,00) sono il contratto.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  WHOLESALE_QUOTE_THRESHOLD,
  calculateResellerShipping,
  getShippingZone,
  shippingQuoteNote,
} from './shipping'

// --- zone -------------------------------------------------------------------

test('zone: IT, Unione Europea e resto del mondo', () => {
  assert.equal(getShippingZone('IT'), 'IT')
  assert.equal(getShippingZone('it'), 'IT', 'il codice paese arriva in minuscolo dal form')

  for (const c of ['DE', 'FR', 'ES', 'NL', 'PL', 'PT', 'SE', 'IE']) {
    assert.equal(getShippingZone(c), 'EU', `${c} e' nel territorio doganale UE`)
  }

  // Fuori dal territorio doganale: la tariffa piatta non copre lo sdoganamento.
  for (const c of ['CH', 'GB', 'NO', 'US', 'BR', 'AU']) {
    assert.equal(getShippingZone(c), 'EXTRA_EU', `${c} e' extra-UE`)
  }

  assert.equal(getShippingZone(''), 'EXTRA_EU', 'paese vuoto: fail-closed sul preventivo')
  assert.equal(getShippingZone('XX'), 'EXTRA_EU')
})

// --- soglia italiana: 60,00 --------------------------------------------------

test('IT 59,99: tariffa piena 7,65 e nessuna gratuita', () => {
  const r = calculateResellerShipping(59.99, 'IT')
  assert.equal(r.mode, 'calculated')
  assert.equal(r.zone, 'IT')
  assert.equal(r.cost, 7.65)
})

test('IT 60,00: gratuita (confine incluso)', () => {
  const r = calculateResellerShipping(60, 'IT')
  assert.equal(r.mode, 'calculated')
  assert.equal(r.cost, 0)
})

test('IT 60,01: gratuita', () => {
  assert.equal(calculateResellerShipping(60.01, 'IT').cost, 0)
})

test('IT 50,00 non e piu la soglia: sotto i 60 si paga', () => {
  // La regressione che questo test esiste per prendere: se `freeAbove` torna a
  // 50, un ordine da 50,00 risponde 0 e il rivenditore non paga il corriere.
  assert.equal(calculateResellerShipping(50, 'IT').cost, 7.65)
  assert.equal(calculateResellerShipping(55, 'IT').cost, 7.65)
})

// --- soglia UE: 150,00 -------------------------------------------------------

test('EU 149,99: tariffa piena 14,99', () => {
  const r = calculateResellerShipping(149.99, 'DE')
  assert.equal(r.mode, 'calculated')
  assert.equal(r.zone, 'EU')
  assert.equal(r.cost, 14.99)
})

test('EU 150,00: gratuita (confine incluso)', () => {
  assert.equal(calculateResellerShipping(150, 'DE').cost, 0)
  assert.equal(calculateResellerShipping(150.01, 'FR').cost, 0)
})

test('la soglia italiana non si applica all UE e viceversa', () => {
  // 60,00 e' gratuita in Italia, non in Germania; 150,00 e' gratuita in
  // Germania, e in Italia sarebbe comunque gratuita ma per altra ragione.
  assert.equal(calculateResellerShipping(60, 'DE').cost, 14.99)
  assert.equal(calculateResellerShipping(150, 'IT').cost, 0)
})

// --- extra-UE: sempre preventivo --------------------------------------------

test('extra-UE (CH, GB, NO): preventivo a qualunque importo', () => {
  for (const country of ['CH', 'GB', 'NO']) {
    for (const amount of [0, 10, 59.99, 100, 499.99, 499.99 + 0.01, 5000]) {
      const r = calculateResellerShipping(amount, country)
      assert.equal(r.mode, 'quote', `${country} ${amount}: deve essere da quotare`)
      assert.equal(r.cost, 0, `${country} ${amount}: nessun costo incassato`)
      assert.equal(r.zone, 'EXTRA_EU')
    }
  }
})

// --- soglia dei 500: preventivo anche in Italia e in UE ----------------------

test('soglia 500: 499,99 calcolato, 500,00 da quotare', () => {
  assert.equal(WHOLESALE_QUOTE_THRESHOLD, 500)

  const justUnder = calculateResellerShipping(499.99, 'IT')
  assert.equal(justUnder.mode, 'calculated')
  assert.equal(justUnder.cost, 0, 'sopra la soglia di gratuita italiana')

  const atThreshold = calculateResellerShipping(500, 'IT')
  assert.equal(atThreshold.mode, 'quote')
  assert.equal(atThreshold.cost, 0)

  assert.equal(calculateResellerShipping(499.99, 'DE').mode, 'calculated')
  assert.equal(calculateResellerShipping(500, 'DE').mode, 'quote')
})

// --- nota sull'ordine -------------------------------------------------------

test('shippingQuoteNote: nota solo in modalita quote', () => {
  assert.equal(shippingQuoteNote('calculated'), null)
  const note = shippingQuoteNote('quote')
  assert.ok(note && note.length > 0)
  assert.match(String(note), /SPEDIZIONE DA QUOTARE/)
})

test('la nota segue la modalita calcolata dal modulo, non un flag del chiamante', () => {
  // Il chiamante reale (`b2b-checkout.ts`) passa `shipping.mode`: questa e' la
  // catena che finisce nelle note dell'ordine.
  const extraEu = calculateResellerShipping(120, 'CH')
  assert.ok(shippingQuoteNote(extraEu.mode))
  const domestic = calculateResellerShipping(120, 'IT')
  assert.equal(shippingQuoteNote(domestic.mode), null)
})
