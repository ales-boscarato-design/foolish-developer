import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SERVICE_PERMISSIONS,
  SERVICE_SECRET_HEADER,
  resolveServiceScope,
  serviceAllows,
  type ScopedCollection,
  type ScopedOperation,
  type ServiceScope,
} from './serviceAccess'

const SCOPES: readonly ServiceScope[] = ['storefront', 'b2b', 'catalog']
const COLLECTIONS: readonly ScopedCollection[] = [
  'orders',
  'products',
  'media',
  'subscriptions',
  'subscription-plans',
  'affiliates',
  'affiliate-conversions',
  'customer-files',
  'offer-config',
  'push-sequences',
]
const OPERATIONS: readonly ScopedOperation[] = ['read', 'create', 'update']

const SECRET_NAMES = [
  'STOREFRONT_API_SECRET',
  'B2B_API_SECRET',
  'CATALOG_API_SECRET',
  'PAYLOAD_API_SECRET',
] as const

function clearSecrets(): void {
  for (const name of SECRET_NAMES) delete process.env[name]
}

function headersWith(secret: string): Headers {
  return new Headers({ [SERVICE_SECRET_HEADER]: secret })
}

test('ogni variabile nuova risolve nel proprio scope', () => {
  const cases = [
    ['STOREFRONT_API_SECRET', 'storefront-secret-value', 'storefront'],
    ['B2B_API_SECRET', 'b2b-secret-value', 'b2b'],
    ['CATALOG_API_SECRET', 'catalog-secret-value', 'catalog'],
  ] as const

  for (const [name, value, expected] of cases) {
    clearSecrets()
    process.env[name] = value
    assert.equal(resolveServiceScope(headersWith(value)), expected, name)
  }
  clearSecrets()
})

test('header supporta anche un record semplice, con nome case-insensitive', () => {
  clearSecrets()
  process.env.STOREFRONT_API_SECRET = 'record-secret'
  assert.equal(
    resolveServiceScope({ 'X-Storefront-Secret': 'record-secret' }),
    'storefront',
  )
  clearSecrets()
})

test('valore sconosciuto, header assente, header vuoto e nessuna env danno null', () => {
  clearSecrets()
  process.env.STOREFRONT_API_SECRET = 'known-secret'

  assert.equal(resolveServiceScope(headersWith('unknown-secret')), null)
  assert.equal(resolveServiceScope(undefined), null)
  assert.equal(resolveServiceScope(new Headers()), null)
  assert.equal(resolveServiceScope(headersWith('')), null)
  assert.equal(resolveServiceScope({}), null)

  clearSecrets()
  assert.equal(resolveServiceScope(headersWith('known-secret')), null)
})

test('lunghezze diverse non lanciano: il confronto resta fail-closed', () => {
  clearSecrets()
  process.env.STOREFRONT_API_SECRET = 'short'
  assert.doesNotThrow(() => resolveServiceScope(headersWith('molto-molto-piu-lungo')))
  assert.equal(resolveServiceScope(headersWith('molto-molto-piu-lungo')), null)
  assert.equal(resolveServiceScope(headersWith('short')), 'storefront')
  clearSecrets()
})

test('PAYLOAD_API_SECRET legacy equivale a storefront e avvisa una sola volta per processo', () => {
  clearSecrets()
  process.env.PAYLOAD_API_SECRET = 'legacy-secret'

  const warnings: string[] = []
  const originalWarn = console.warn
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(' '))
  }
  try {
    assert.equal(resolveServiceScope(headersWith('legacy-secret')), 'storefront')
    assert.equal(resolveServiceScope(headersWith('legacy-secret')), 'storefront')
    assert.equal(resolveServiceScope(headersWith('ancora-sbagliato')), null)
  } finally {
    console.warn = originalWarn
    clearSecrets()
  }

  assert.equal(warnings.length, 1, 'il legacy deve avvisare una sola volta per processo')
  assert.match(warnings[0], /PAYLOAD_API_SECRET/)
  assert.match(warnings[0], /legacy/)
})

test('il nome nuovo ha precedenza sul legacy', () => {
  clearSecrets()
  process.env.PAYLOAD_API_SECRET = 'legacy-value'
  process.env.STOREFRONT_API_SECRET = 'new-storefront-value'
  process.env.B2B_API_SECRET = 'new-b2b-value'

  assert.equal(resolveServiceScope(headersWith('new-storefront-value')), 'storefront')
  assert.equal(resolveServiceScope(headersWith('new-b2b-value')), 'b2b')
  assert.equal(resolveServiceScope(headersWith('legacy-value')), 'storefront')
  clearSecrets()
})

test('serviceAllows implementa la matrice completa', () => {
  const expected: Record<ServiceScope, Partial<Record<ScopedCollection, readonly ScopedOperation[]>>> = {
    storefront: {
      orders: ['read', 'create', 'update'],
      media: ['read', 'create'],
      subscriptions: ['read', 'create', 'update'],
      'subscription-plans': ['read'],
      affiliates: ['read'],
      'affiliate-conversions': ['read'],
      'customer-files': ['read'],
      'offer-config': ['read'],
      'push-sequences': ['read'],
    },
    b2b: {
      orders: ['read', 'create', 'update'],
    },
    catalog: {
      products: ['create', 'update'],
    },
  }

  for (const scope of SCOPES) {
    for (const collection of COLLECTIONS) {
      const allowed = expected[scope][collection] ?? []
      assert.deepEqual(
        SERVICE_PERMISSIONS[scope][collection],
        allowed,
        `${scope}/${collection}: matrice dichiarata`,
      )
      for (const operation of OPERATIONS) {
        assert.equal(
          serviceAllows(scope, collection, operation),
          allowed.includes(operation),
          `${scope}/${collection}/${operation}`,
        )
      }
    }
  }

  // Casi espliciti richiesti dal brief, per non fidarsi solo del ciclo.
  assert.equal(serviceAllows('storefront', 'orders', 'create'), true)
  assert.equal(serviceAllows('b2b', 'products', 'update'), false)
  assert.equal(serviceAllows('catalog', 'products', 'update'), true)
  assert.equal(serviceAllows('b2b', 'subscriptions', 'update'), false)
  assert.equal(serviceAllows('storefront', 'subscriptions', 'update'), true)
  assert.equal(serviceAllows(null, 'orders', 'read'), false)
})
