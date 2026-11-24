import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSubscriptionCheckoutResponse } from './subscription-checkout-response'

/**
 * Il pulsante dell'abbonamento non deve mai restare muto: se il server
 * risponde 400/503, se il corpo non e' JSON o se la rete cade, la pagina
 * deve poter mostrare un errore invece di tornare inattiva in silenzio.
 */
test('200 con un checkoutUrl valido apre il checkout', () => {
  assert.deepEqual(
    parseSubscriptionCheckoutResponse(200, { checkoutUrl: 'https://checkout.stripe.com/x' }),
    { checkoutUrl: 'https://checkout.stripe.com/x' },
  )
})

test('200 senza checkoutUrl non apre il checkout', () => {
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, {}), { error: true })
})

test('un rifiuto per parametri non validi resta un errore', () => {
  assert.deepEqual(parseSubscriptionCheckoutResponse(400, { error: 'Parametri non validi' }), { error: true })
})

test('un servizio non configurato resta un errore', () => {
  assert.deepEqual(parseSubscriptionCheckoutResponse(503, { error: 'Stripe non configurato' }), { error: true })
})

test('un corpo non oggetto non fa esplodere il parsing', () => {
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, null), { error: true })
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, 'stringa'), { error: true })
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, []), { error: true })
})

test('un checkoutUrl vuoto o non stringa non porta al checkout', () => {
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, { checkoutUrl: '' }), { error: true })
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, { checkoutUrl: '   ' }), { error: true })
  assert.deepEqual(parseSubscriptionCheckoutResponse(200, { checkoutUrl: 42 }), { error: true })
})
