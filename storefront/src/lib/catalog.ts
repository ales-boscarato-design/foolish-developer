// Server-only resolver: imported by API routes, never by client components.
import {
  MAX_CART_SUBTOTAL_CENTS,
  MAX_CHECKOUT_ITEMS,
  MAX_ITEM_PRICE_CENTS,
  MAX_ITEM_QUANTITY,
  moneyToCents,
  type CheckoutCartItem,
} from './promo'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const CMS_API = `${CMS_URL}/api`
const PACK_SEPARATOR = '-pack-'

type CatalogProduct = {
  id?: unknown
  name?: unknown
  active?: unknown
  variants?: unknown
  packs?: unknown
}

type CatalogVariant = {
  sku?: unknown
  label?: unknown
  price?: unknown
  stockStatus?: unknown
  limitedQty?: unknown
}

type CatalogPack = {
  id?: unknown
  name?: unknown
  quantity?: unknown
  discountPercent?: unknown
}

export type CatalogLookup =
  | { status: 'found'; product: unknown }
  | { status: 'not-found' }
  | { status: 'unavailable' }

export type CatalogProductFetcher = (query: {
  productId?: string
  sku?: string
}) => Promise<CatalogLookup>

export type CatalogResolution =
  | { status: 'ok'; items: CheckoutCartItem[] }
  | { status: 'invalid' }
  | { status: 'unavailable' }

export interface CatalogResolverOptions {
  fetchProduct?: CatalogProductFetcher
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function safeIdentifier(value: unknown, maxLength = 160): string | null {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value <= 0) return null
    const normalized = String(value)
    return normalized.length <= maxLength ? normalized : null
  }
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0
    && normalized.length <= maxLength
    && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(normalized)
    ? normalized
    : null
}

function safeSku(value: unknown): string | null {
  return typeof value === 'string' ? safeIdentifier(value, 100) : null
}

function boundedCatalogString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= maxLength ? normalized : null
}

function parsePackSku(sku: string): { baseSku: string; packId: string } | null {
  const separator = sku.indexOf(PACK_SEPARATOR)
  if (separator < 1) return null

  const baseSku = safeSku(sku.slice(0, separator))
  const packId = safeIdentifier(sku.slice(separator + PACK_SEPARATOR.length))
  return baseSku && packId ? { baseSku, packId } : null
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function validLimitedQty(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null
  return value
}

function validDiscountPercent(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 1
    && value <= 50
    ? value
    : null
}

function productFromLookup(lookup: CatalogLookup): CatalogProduct | null {
  if (lookup.status !== 'found' || !isPlainObject(lookup.product)) return null
  return lookup.product as CatalogProduct
}

async function fetchProductFromCms(query: { productId?: string; sku?: string }): Promise<CatalogLookup> {
  const url = query.productId
    ? `${CMS_API}/products/${encodeURIComponent(query.productId)}?depth=0&locale=it`
    : `${CMS_API}/products?where[variants.sku][equals]=${encodeURIComponent(query.sku ?? '')}&depth=0&limit=10&locale=it`

  try {
    const response = await fetch(url, {
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
    })
    if (response.status === 404) return { status: 'not-found' }
    if (!response.ok) return { status: 'unavailable' }

    const data: unknown = await response.json()
    if (query.productId) return { status: 'found', product: data }
    if (!isPlainObject(data) || !Array.isArray(data.docs)) return { status: 'unavailable' }

    const matchingProducts = data.docs.filter((candidate: unknown) => {
      if (!isPlainObject(candidate) || !Array.isArray(candidate.variants)) return false
      return candidate.variants.some((variant: unknown) => (
        isPlainObject(variant) && variant.sku === query.sku
      ))
    })
    if (matchingProducts.length > 1) return { status: 'unavailable' }
    return matchingProducts[0]
      ? { status: 'found', product: matchingProducts[0] }
      : { status: 'not-found' }
  } catch {
    return { status: 'unavailable' }
  }
}

function resolveProductId(product: CatalogProduct, requestedProductId: string | undefined): 'ok' | 'invalid' | 'unavailable' {
  if (!requestedProductId) return 'ok'
  if (product.id === undefined || product.id === null) return 'unavailable'
  const resolvedProductId = safeIdentifier(String(product.id))
  if (!resolvedProductId) return 'unavailable'
  return resolvedProductId === requestedProductId ? 'ok' : 'invalid'
}

export async function resolveCheckoutCatalog(
  rawItems: unknown,
  options: CatalogResolverOptions = {},
): Promise<CatalogResolution> {
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_CHECKOUT_ITEMS) {
    return { status: 'invalid' }
  }

  const fetchProduct = options.fetchProduct ?? fetchProductFromCms
  const productCache = new Map<string, CatalogLookup>()
  const resolvedItems: CheckoutCartItem[] = []
  let subtotalCents = 0

  for (const rawItem of rawItems) {
    if (!isPlainObject(rawItem)) return { status: 'invalid' }

    const sku = safeSku(rawItem.sku)
    const quantity = rawItem.quantity
    if (
      !sku
      || typeof quantity !== 'number'
      || !Number.isSafeInteger(quantity)
      || quantity <= 0
      || quantity > MAX_ITEM_QUANTITY
    ) return { status: 'invalid' }

    // A productId is authoritative when present. SKU lookup exists only for
    // legacy cart records that never had a productId field.
    const productIdPresent = hasOwn(rawItem, 'productId')
    const productIdCandidate = productIdPresent ? safeIdentifier(rawItem.productId) : undefined
    if (productIdPresent && !productIdCandidate) return { status: 'invalid' }
    const productId: string | undefined = productIdCandidate ?? undefined

    const pack = sku.includes(PACK_SEPARATOR) ? parsePackSku(sku) : null
    if (sku.includes(PACK_SEPARATOR) && !pack) return { status: 'invalid' }
    const baseSku = pack?.baseSku ?? sku
    const cacheKey = productId ? `id:${productId}` : `sku:${baseSku}`

    let lookup = productCache.get(cacheKey)
    if (!lookup) {
      try {
        lookup = await fetchProduct(productId ? { productId } : { sku: baseSku })
      } catch {
        return { status: 'unavailable' }
      }
      productCache.set(cacheKey, lookup)
    }
    if (lookup.status === 'unavailable') return { status: 'unavailable' }
    if (lookup.status === 'not-found') return { status: 'invalid' }

    const product = productFromLookup(lookup)
    if (!product) return { status: 'unavailable' }
    const productIdStatus = resolveProductId(product, productId)
    if (productIdStatus === 'invalid') return { status: 'invalid' }
    if (productIdStatus === 'unavailable') return { status: 'unavailable' }

    if (product.active === false) return { status: 'invalid' }
    if (product.active !== true) return { status: 'unavailable' }
    const productName = boundedCatalogString(product.name, 120)
    if (!productName || !Array.isArray(product.variants)) return { status: 'unavailable' }

    const variant = product.variants.find((candidate: unknown) => (
      isPlainObject(candidate) && candidate.sku === baseSku
    )) as CatalogVariant | undefined
    if (!variant) return { status: 'invalid' }

    const variantSku = safeSku(variant.sku)
    const variantLabel = boundedCatalogString(variant.label, 80)
    const variantPriceCents = moneyToCents(variant.price)
    const limitedQty = validLimitedQty(variant.limitedQty)
    if (
      !variantSku
      || variantSku !== baseSku
      || !variantLabel
      || variantPriceCents === null
      || variantPriceCents <= 0
      || variantPriceCents > MAX_ITEM_PRICE_CENTS
      || limitedQty === null
    ) return { status: 'unavailable' }
    if (variant.stockStatus === 'unavailable') return { status: 'invalid' }
    if (variant.stockStatus !== 'available' && variant.stockStatus !== 'low') return { status: 'unavailable' }

    const currentMaxQty = Math.min(MAX_ITEM_QUANTITY, limitedQty ?? MAX_ITEM_QUANTITY)
    if (quantity > currentMaxQty) return { status: 'invalid' }

    let unitPriceCents = variantPriceCents
    if (pack) {
      if (!quantity || quantity % 1 !== 0) return { status: 'invalid' }
      if (!Array.isArray(product.packs)) return { status: 'invalid' }

      const catalogPack = product.packs.find((candidate: unknown) => (
        isPlainObject(candidate) && candidate.id === pack.packId
      )) as CatalogPack | undefined
      if (!catalogPack) return { status: 'invalid' }

      const packQuantity = catalogPack.quantity
      const discountPercent = validDiscountPercent(catalogPack.discountPercent)
      const packName = boundedCatalogString(catalogPack.name, 120)
      if (
        !packName
        || typeof packQuantity !== 'number'
        || !Number.isSafeInteger(packQuantity)
        || packQuantity < 2
        || packQuantity > MAX_ITEM_QUANTITY
        || discountPercent === null
        || quantity % packQuantity !== 0
      ) return { status: 'invalid' }

      // Work in integer cents and round exactly once at the unit-price boundary.
      unitPriceCents = Math.round((variantPriceCents * (100 - discountPercent)) / 100)
      if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > MAX_ITEM_PRICE_CENTS) {
        return { status: 'invalid' }
      }
    }

    const lineCents = unitPriceCents * quantity
    if (
      !Number.isSafeInteger(lineCents)
      || !Number.isSafeInteger(subtotalCents + lineCents)
      || subtotalCents + lineCents > MAX_CART_SUBTOTAL_CENTS
    ) return { status: 'invalid' }
    subtotalCents += lineCents

    resolvedItems.push({
      productName,
      variantLabel,
      price: unitPriceCents / 100,
      quantity,
      sku,
    })
  }

  return subtotalCents > 0 ? { status: 'ok', items: resolvedItems } : { status: 'invalid' }
}
