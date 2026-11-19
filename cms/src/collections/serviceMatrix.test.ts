import assert from 'node:assert/strict'
import test from 'node:test'
import type { CollectionConfig, PayloadRequest } from 'payload'
import { AffiliateConversions } from './AffiliateConversions'
import { Affiliates } from './Affiliates'
import { CustomerFiles } from './CustomerFiles'
import { Media } from './Media'
import { OfferConfig } from './OfferConfig'
import { Orders } from './Orders'
import { Products } from './Products'
import { PushSequences } from './PushSequences'
import { SubscriptionPlans } from './SubscriptionPlans'
import { Subscriptions } from './Subscriptions'

type Operation = 'read' | 'create' | 'update'
type AccessFn = (args: { req: PayloadRequest }) => unknown

const SECRET_NAMES = [
  'STOREFRONT_API_SECRET',
  'B2B_API_SECRET',
  'CATALOG_API_SECRET',
  'PAYLOAD_API_SECRET',
] as const

function clearSecrets(): void {
  for (const name of SECRET_NAMES) delete process.env[name]
}

function useSecret(name: (typeof SECRET_NAMES)[number], value: string): void {
  clearSecrets()
  process.env[name] = value
}

function request(secret?: string, user: unknown = null): PayloadRequest {
  const headers = new Headers()
  if (secret !== undefined) headers.set('x-storefront-secret', secret)
  return { user, headers } as unknown as PayloadRequest
}

function allows(collection: CollectionConfig, operation: Operation, req: PayloadRequest): unknown {
  const fn = collection.access?.[operation] as AccessFn | undefined
  assert.equal(typeof fn, 'function', `${collection.slug}.access.${operation} non e una funzione`)
  return (fn as AccessFn)({ req })
}

test('regressione rosso-di-oggi: il valore legacy apre products.create e subscriptions.update', () => {
  useSecret('PAYLOAD_API_SECRET', 'legacy-value')
  const req = request('legacy-value')

  assert.equal(allows(Products, 'create', req), false)
  assert.equal(allows(Products, 'update', req), false)
  assert.equal(allows(Orders, 'create', req), true)
  assert.equal(allows(Subscriptions, 'update', req), true)
})

test('B2B_API_SECRET: orders si, subscriptions e products no', () => {
  useSecret('B2B_API_SECRET', 'b2b-value')
  const req = request('b2b-value')

  assert.equal(allows(Orders, 'read', req), true)
  assert.equal(allows(Orders, 'create', req), true)
  assert.equal(allows(Orders, 'update', req), true)
  assert.equal(allows(Subscriptions, 'update', req), false)
  assert.equal(allows(Subscriptions, 'read', req), false)
  assert.equal(allows(Products, 'create', req), false)
  assert.equal(allows(Products, 'update', req), false)
})

test('CATALOG_API_SECRET: products.update si, orders e subscriptions no', () => {
  useSecret('CATALOG_API_SECRET', 'catalog-value')
  const req = request('catalog-value')

  assert.equal(allows(Products, 'create', req), true)
  assert.equal(allows(Products, 'update', req), true)
  assert.equal(allows(Orders, 'create', req), false)
  assert.equal(allows(Subscriptions, 'update', req), false)
})

test('STOREFRONT_API_SECRET: permessi limitati a cio che lo storefront scrive davvero', () => {
  useSecret('STOREFRONT_API_SECRET', 'storefront-value')
  const req = request('storefront-value')

  assert.equal(allows(Orders, 'read', req), true)
  assert.equal(allows(Orders, 'create', req), true)
  assert.equal(allows(Orders, 'update', req), true)
  assert.equal(allows(Products, 'create', req), false)
  assert.equal(allows(Products, 'update', req), false)
  // Residuo dichiarato: l'area cliente aggiorna davvero le subscriptions.
  assert.equal(allows(Subscriptions, 'update', req), true)
  assert.equal(allows(SubscriptionPlans, 'read', req), true)
  assert.equal(allows(Affiliates, 'read', req), true)
  assert.equal(allows(AffiliateConversions, 'read', req), true)
  assert.equal(allows(CustomerFiles, 'read', req), true)
  assert.equal(allows(OfferConfig, 'read', req), true)
  assert.equal(allows(PushSequences, 'read', req), true)
})

test('Media: lo storefront legge i privati e crea, ma il segreto B2B non fa ne l uno ne l altro', () => {
  useSecret('STOREFRONT_API_SECRET', 'storefront-value')
  assert.equal(allows(Media, 'read', request('storefront-value')), true)
  assert.equal(allows(Media, 'create', request('storefront-value')), true)

  useSecret('B2B_API_SECRET', 'b2b-value')
  assert.deepEqual(
    allows(Media, 'read', request('b2b-value')),
    { visibility: { not_equals: 'private' } },
  )
  assert.equal(allows(Media, 'create', request('b2b-value')), false)
})

test('con req.user presente tutto e consentito, senza segreto', () => {
  clearSecrets()
  const req = request(undefined, { id: 1 })

  for (const collection of [Products, Orders, Media, Subscriptions, SubscriptionPlans, Affiliates, AffiliateConversions, CustomerFiles, OfferConfig, PushSequences]) {
    for (const operation of ['read', 'create', 'update'] as const) {
      // Media non dichiara update: Payload usa il default (solo autenticati), che non
      // passa da questa matrice. Qui si verificano le access function reali definite.
      if (collection.access?.[operation] === undefined) continue
      assert.equal(allows(collection, operation, req), true, `${collection.slug}.${operation} con utente`)
    }
  }
})

test('senza segreto e senza utente tutto e chiuso (products.read resta pubblica)', () => {
  clearSecrets()
  const req = request()

  for (const collection of [Orders, Subscriptions, SubscriptionPlans, Affiliates, AffiliateConversions, CustomerFiles, OfferConfig, PushSequences]) {
    for (const operation of ['read', 'create', 'update'] as const) {
      assert.equal(allows(collection, operation, req), false, `${collection.slug}.${operation} anonimo`)
    }
  }
  assert.equal(allows(Products, 'create', req), false)
  assert.equal(allows(Products, 'update', req), false)
  assert.equal(allows(Media, 'create', req), false)
  assert.deepEqual(allows(Media, 'read', req), { visibility: { not_equals: 'private' } })
  // products.read e' pubblica per scelta e non passa dalla matrice.
  assert.equal(allows(Products, 'read', req), true)
})
