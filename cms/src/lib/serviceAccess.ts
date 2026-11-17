import crypto from 'node:crypto'

/**
 * Scope dei segreti servizio->CMS.
 *
 * Prima di questo modulo esisteva un solo `PAYLOAD_API_SECRET` condiviso da
 * storefront, B2B e script di catalogo: chi ne leggeva il valore da un servizio
 * poteva scrivere nel CMS come se fosse uno degli altri. Qui il segreto viene
 * risolto nello scope che lo possiede e ogni collection dichiara le sole
 * operazioni che quello scope deve poter fare.
 */
export type ServiceScope = 'storefront' | 'b2b' | 'catalog'

export const SERVICE_SECRET_HEADER = 'x-storefront-secret'

export type ScopedCollection =
  | 'orders'
  | 'products'
  | 'media'
  | 'subscriptions'
  | 'subscription-plans'
  | 'affiliates'
  | 'affiliate-conversions'
  | 'customer-files'
  | 'offer-config'
  | 'push-sequences'

export type ScopedOperation = 'read' | 'create' | 'update'

const NONE: readonly ScopedOperation[] = []

/**
 * Matrice servizio -> collection -> operazioni consentite.
 *
 * Le operazioni sono dedotte da cio' che il codice di ogni servizio scrive
 * davvero, non da un permesso teorico. `products.read` resta pubblica e non
 * passa da qui. `delete` resta riservato a `req.user` in tutte le collection.
 */
export const SERVICE_PERMISSIONS: Record<
  ServiceScope,
  Record<ScopedCollection, readonly ScopedOperation[]>
> = {
  storefront: {
    orders: ['read', 'create', 'update'],
    products: NONE,
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
    products: NONE,
    media: NONE,
    subscriptions: NONE,
    'subscription-plans': NONE,
    affiliates: NONE,
    'affiliate-conversions': NONE,
    'customer-files': NONE,
    'offer-config': NONE,
    'push-sequences': NONE,
  },
  catalog: {
    orders: NONE,
    products: ['create', 'update'],
    media: NONE,
    subscriptions: NONE,
    'subscription-plans': NONE,
    affiliates: NONE,
    'affiliate-conversions': NONE,
    'customer-files': NONE,
    'offer-config': NONE,
    'push-sequences': NONE,
  },
}

let legacyWarningEmitted = false

function configuredSecret(name: string): string | null {
  const value = process.env[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Confronto a tempo costante; lunghezze diverse non lanciano e non combaciano. */
function secretMatches(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided, 'utf8')
  const expectedBuffer = Buffer.from(expected, 'utf8')
  if (providedBuffer.length !== expectedBuffer.length) return false
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer)
}

function headerValue(
  headers: Headers | Record<string, string> | undefined,
): string | null {
  if (!headers) return null

  const candidate = headers as { get?: unknown }
  if (typeof candidate.get === 'function') {
    const value = (headers as Headers).get(SERVICE_SECRET_HEADER)
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  if (typeof headers !== 'object') return null
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === SERVICE_SECRET_HEADER && typeof value === 'string' && value.length > 0) {
      return value
    }
  }
  return null
}

function warnLegacyOnce(scope: ServiceScope): void {
  if (legacyWarningEmitted) return
  legacyWarningEmitted = true
  console.warn(
    '[cms] PAYLOAD_API_SECRET usato come segreto legacy: viene trattato come scope ' +
      `"${scope}". E' il valore unico in transizione e va rimosso dopo la rotazione ` +
      'dei segreti per servizio (STOREFRONT_API_SECRET, B2B_API_SECRET, CATALOG_API_SECRET).',
  )
}

/**
 * Risolve lo scope dal solo header condiviso. Nessun segreto configurato,
 * header assente o valore sconosciuto producono `null` (fail-closed).
 */
export function resolveServiceScope(
  headers: Headers | Record<string, string> | undefined,
): ServiceScope | null {
  const provided = headerValue(headers)
  if (!provided) return null

  const storefrontSecret = configuredSecret('STOREFRONT_API_SECRET')
  if (storefrontSecret && secretMatches(provided, storefrontSecret)) return 'storefront'

  const b2bSecret = configuredSecret('B2B_API_SECRET')
  if (b2bSecret && secretMatches(provided, b2bSecret)) return 'b2b'

  const catalogSecret = configuredSecret('CATALOG_API_SECRET')
  if (catalogSecret && secretMatches(provided, catalogSecret)) return 'catalog'

  const legacySecret = configuredSecret('PAYLOAD_API_SECRET')
  if (legacySecret && secretMatches(provided, legacySecret)) {
    warnLegacyOnce('storefront')
    return 'storefront'
  }

  return null
}

export function serviceAllows(
  scope: ServiceScope | null,
  collection: ScopedCollection,
  operation: ScopedOperation,
): boolean {
  if (!scope) return false
  return SERVICE_PERMISSIONS[scope]?.[collection]?.includes(operation) ?? false
}

export function hasServiceAccess(
  req: { headers?: unknown },
  collection: ScopedCollection,
  operation: ScopedOperation,
): boolean {
  return serviceAllows(
    resolveServiceScope(req.headers as Headers | Record<string, string> | undefined),
    collection,
    operation,
  )
}
