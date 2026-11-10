/**
 * Precedenza e fedelta' dell'indirizzo usato dagli ordini Printful.
 *
 * Il test di rotta (`src/app/api/webhook/printful-fulfillment/route.test.ts`)
 * prova il corpo vero della POST a Printful; questo copre i casi che li' non si
 * isolano bene: nessun dato, spazi, country minuscolo, campi parziali, e la
 * regola che i campi non si mescolano fra fonti diverse.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePrintfulShipping } from './printful-shipping'

const METADATA = {
  customer_address: 'Via Vecchia 1|Torino|10100',
  customer_country: 'IT',
}

test('collected_information vince su legacy e metadata', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      collected_information: {
        shipping_details: {
          address: { line1: 'Via Nuova 99', line2: 'Scala B', city: 'Milano', postal_code: '20100', country: 'it' },
        },
      },
      shipping_details: { address: { line1: 'Via Legacy 7', city: 'Bologna', postal_code: '40100', country: 'IT' } },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'collected_information')
  assert.equal(resolved.complete, true)
  assert.deepEqual(resolved.recipient, {
    name: 'Mario Rossi',
    address1: 'Via Nuova 99',
    address2: 'Scala B',
    city: 'Milano',
    postalCode: '20100',
    country: 'IT',
  })
})

test('senza collected_information usa il campo legacy (sessioni vecchie)', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      shipping_details: { address: { line1: 'Via Legacy 7', city: 'Bologna', postal_code: '40100', country: 'IT' } },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'legacy_shipping_details')
  assert.equal(resolved.recipient.address1, 'Via Legacy 7')
  assert.equal(resolved.recipient.city, 'Bologna')
})

test('senza nessuna fonte Stripe usa i metadata del checkout', () => {
  const resolved = resolvePrintfulShipping({ session: {}, metadata: METADATA, customerName: 'Mario Rossi' })

  assert.equal(resolved.source, 'metadata')
  assert.equal(resolved.complete, true)
  assert.deepEqual(resolved.recipient, {
    name: 'Mario Rossi',
    address1: 'Via Vecchia 1',
    address2: '',
    city: 'Torino',
    postalCode: '10100',
    country: 'IT',
  })
})

test('oggetto indirizzo presente ma vuoto non maschera la fonte successiva', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      collected_information: { shipping_details: { address: {} } },
      shipping_details: { address: { line1: 'Via Legacy 7', city: 'Bologna', postal_code: '40100', country: 'IT' } },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'legacy_shipping_details')
  assert.equal(resolved.recipient.address1, 'Via Legacy 7')
})

test('indirizzo parziale: nessun campo preso in prestito da un altra fonte', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      collected_information: { shipping_details: { address: { line1: 'Via Nuova 99', country: 'IT' } } },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'collected_information')
  assert.equal(resolved.complete, false)
  assert.equal(resolved.recipient.address1, 'Via Nuova 99')
  assert.equal(resolved.recipient.city, '')
  assert.equal(resolved.recipient.postalCode, '')
  assert.equal(resolved.recipient.country, 'IT')
})

test('gli spazi accidentali non diventano un indirizzo', () => {
  const resolved = resolvePrintfulShipping({
    session: { collected_information: { shipping_details: { address: { line1: '   ', city: '', country: '  ' } } } },
    metadata: METADATA,
    customerName: '  Mario Rossi  ',
  })

  assert.equal(resolved.source, 'metadata')
  assert.equal(resolved.recipient.name, 'Mario Rossi')
})

test('il nome scritto nel form di spedizione vince su customer_name dei metadata', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      collected_information: {
        shipping_details: {
          name: 'Anna Bianchi',
          address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' },
        },
      },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.recipient.name, 'Anna Bianchi')
})

test('senza nome nel form di spedizione resta customer_name', () => {
  const resolved = resolvePrintfulShipping({
    session: {
      collected_information: {
        shipping_details: { name: null, address: { line1: 'Via Nuova 99', city: 'Milano', postal_code: '20100', country: 'IT' } },
      },
    },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.recipient.name, 'Mario Rossi')
})

test('indirizzo con il solo paese: resta la fonte scelta e l ordine e incompleto (fail-closed)', () => {
  // Scelta dichiarata: un indirizzo che porta solo il paese non e' un indirizzo,
  // ma preferiamo un ordine che Printful rifiuta a un pacco spedito al vecchio
  // indirizzo dei metadata.
  const resolved = resolvePrintfulShipping({
    session: { collected_information: { shipping_details: { address: { country: 'IT' } } } },
    metadata: METADATA,
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'collected_information')
  assert.equal(resolved.complete, false)
  assert.equal(resolved.recipient.address1, '')
  assert.equal(resolved.recipient.country, 'IT')
})

test('metadata assenti: nessuna eccezione, indirizzo vuoto dichiarato incompleto', () => {
  const resolved = resolvePrintfulShipping({ session: {}, metadata: null, customerName: null })

  assert.equal(resolved.source, 'metadata')
  assert.equal(resolved.complete, false)
  assert.deepEqual(resolved.recipient, {
    name: '',
    address1: '',
    address2: '',
    city: '',
    postalCode: '',
    country: '',
  })
})

test('il paese non si prende da un altra fonte quando quella scelta non ce l ha', () => {
  // Scelta consapevole, non un effetto collaterale: il webhook Stripe usa
  // `recipient.country` anche per il paese del cliente nel CMS, quindi qui si
  // fissa che la regola "i campi non si mescolano" vale anche per il paese.
  // Se un giorno il consumatore volesse il ripiego per singolo campo, dovrebbe
  // chiederlo esplicitamente: mescolare in silenzio qui vorrebbe dire spedire
  // un pacco con il paese di un'altra fonte.
  const resolved = resolvePrintfulShipping({
    session: { collected_information: { shipping_details: { address: { line1: 'Via Nuova 1', city: 'Milano', postal_code: '20100' } } } },
    metadata: METADATA, // METADATA porta customer_country
    customerName: 'Mario Rossi',
  })

  assert.equal(resolved.source, 'collected_information')
  assert.equal(resolved.recipient.country, '')
  assert.equal(resolved.complete, false)
})
