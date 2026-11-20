import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  DELIVERY_PROMISE_REASONS,
  DELIVERY_PROMISE_ZONES,
  requiresDeliveryPromise,
  validateDeliveryPromiseInput,
} from './delivery-promise'

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

type Fixture = {
  valid: Array<{ name: string; snapshot: Record<string, unknown> }>
  invalid: Array<{ name: string; snapshot: Record<string, unknown> }>
}

/**
 * Lo stesso file che usa lo storefront: se i due validatori divergono, un ordine
 * pagato porta al CMS uno snapshot che di la' e' valido e di qua no (o il
 * contrario), e la data promessa sparisce o blocca la creazione dell'ordine.
 */
const fixture = JSON.parse(
  readFileSync(join(REPO_ROOT, 'storefront/src/lib/__fixtures__/delivery-promise.json'), 'utf8'),
) as Fixture

test('il contratto condiviso con lo storefront e\' rispettato', () => {
  for (const { name, snapshot } of fixture.valid) {
    const result = validateDeliveryPromiseInput(snapshot)
    assert.equal(result.error, null, `doveva essere valido: ${name}`)
    assert.notEqual(result.snapshot, null, `doveva produrre uno snapshot: ${name}`)
  }
  for (const { name, snapshot } of fixture.invalid) {
    const result = validateDeliveryPromiseInput(snapshot)
    assert.equal(result.snapshot, null, `doveva essere rifiutato: ${name}`)
    assert.notEqual(result.error, null, `doveva dire perche': ${name}`)
  }
})

test('un gruppo vuoto e\' l\'assenza, non uno snapshot', () => {
  for (const empty of [
    null,
    undefined,
    {},
    { promiseShown: null, reason: null, zone: null, departureDate: null, estimatedDeliveryDate: null, productionDays: null, marginDays: null, fallback: null, version: null, calculatedAt: null },
  ]) {
    const result = validateDeliveryPromiseInput(empty)
    assert.equal(result.snapshot, null)
    assert.equal(result.error, null)
  }
})

test('un campo in piu\' non previsto fa fallire chiuso', () => {
  const result = validateDeliveryPromiseInput({
    version: 1,
    promiseShown: false,
    zone: null,
    departureDate: null,
    estimatedDeliveryDate: null,
    productionDays: null,
    marginDays: null,
    fallback: false,
    reason: 'not_shown',
    calculatedAt: '2026-11-20T09:00:00.000Z',
    estimatedDelivery: '2026-11-25',
  })
  assert.equal(result.snapshot, null)
  assert.match(result.error ?? '', /campi non previsti/)
})

test('la data di calcolo si normalizza da stringa o da Date', () => {
  const base = {
    version: 1,
    promiseShown: false,
    zone: null,
    departureDate: null,
    estimatedDeliveryDate: null,
    productionDays: null,
    marginDays: null,
    fallback: false,
    reason: 'not_shown' as const,
  }
  const fromDate = validateDeliveryPromiseInput({ ...base, calculatedAt: new Date('2026-11-20T09:00:00.000Z') })
  assert.equal(fromDate.snapshot?.calculatedAt, '2026-11-20T09:00:00.000Z')
  const fromString = validateDeliveryPromiseInput({ ...base, calculatedAt: '2026-11-20T09:00:00Z' })
  assert.equal(fromString.snapshot?.calculatedAt, '2026-11-20T09:00:00.000Z')
})

test('le opzioni dei select sono le stesse che il validatore accetta', () => {
  assert.deepEqual([...DELIVERY_PROMISE_ZONES], ['IT_EU', 'EXTRA_EU'])
  assert.deepEqual([...DELIVERY_PROMISE_REASONS], ['ok', 'estimate_unavailable', 'not_shown', 'not_captured'])
})

/**
 * L'obbligo dello snapshot vale per gli ordini creati dalla macchina: un ordine
 * inserito a mano dal CMS, un rinnovo di abbonamento o un ordine B2B non hanno
 * una promessa di carrello e restano legittimamente senza.
 */
test('lo snapshot e\' obbligatorio solo per gli ordini del checkout Stripe', () => {
  assert.equal(requiresDeliveryPromise({ source: 'storefront', paymentMethod: 'stripe', stripeSessionId: 'cs_live_1' }), true)
  assert.equal(requiresDeliveryPromise({ source: 'storefront', paymentMethod: 'stripe', stripeSessionId: '' }), false)
  assert.equal(requiresDeliveryPromise({ source: 'storefront', paymentMethod: 'stripe', stripeSessionId: null }), false)
  assert.equal(requiresDeliveryPromise({ source: 'storefront', paymentMethod: 'manual', stripeSessionId: 'cs_live_1' }), false)
  assert.equal(requiresDeliveryPromise({ source: 'manual', paymentMethod: 'stripe', stripeSessionId: 'cs_live_1' }), false)
  assert.equal(requiresDeliveryPromise({ source: 'subscription', paymentMethod: null, stripeSessionId: null }), false)
  assert.equal(requiresDeliveryPromise({ source: 'reseller', paymentMethod: 'stripe', stripeSessionId: 'cs_live_1' }), false)
})
