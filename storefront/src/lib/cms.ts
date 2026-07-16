/**
 * Payload CMS API client — usato dal server-side Next.js.
 */

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
const CMS_API = `${CMS_URL}/api`

/**
 * Trasforma URL immagini CMS in path locale /cms-media/* per evitare
 * problemi di remotePatterns e Cloudflare WAF su /_next/image con URL esterne.
 */
export function cmsImageUrl(url: string | undefined | null): string {
  if (!url) return ''
  // Match any CMS host — avoids env var dependency in browser context where
  // PAYLOAD_PUBLIC_URL (no NEXT_PUBLIC_ prefix) is undefined.
  // decodeURIComponent prevents double-encoding when Next.js re-encodes the src.
  const match = url.match(/^https?:\/\/[^/]+\/api\/media\/file\/(.+)$/)
  if (match) return `/cms-media/${decodeURIComponent(match[1])}`
  return url
}

export interface ProductAttributeOption {
  value: string
  label: string
}

export interface ProductAttribute {
  name: string
  label: string
  options: ProductAttributeOption[]
}

export interface ProductVariantCombination {
  texture?: string
  colore?: string
  spessore?: string
  stencil?: string
}

export interface ProductVariant {
  image?: { url: string; alt?: string; sizes?: Record<string, { url: string }> }
  description?: string
  sku: string
  label: string
  price: number
  stockStatus: 'available' | 'low' | 'unavailable'
  limitedQty?: number
  dimensions?: string
  thicknessMm?: number
  validCombinations: ProductVariantCombination[]
}

export interface ProductImage {
  image: { url: string; alt?: string; sizes?: Record<string, { url: string }> }
  alt?: string
}

export interface ProductVideo {
  video: { url: string }
}

export interface FeatureHighlight {
  icon: 'sparkles' | 'shield' | 'star' | 'truck'
  title: string
  description: string
}

export interface UsageStep {
  step: string
  title: string
  description: string
}

export interface WhatsInTheBox {
  label: string
  description: string
}

export interface ProductPack {
  id: string
  name: string
  quantity: number
  discountPercent: number
  badgeText?: string
}

export interface ProductComponent {
  id: string
  name: string
  slug: string
  basePrice: number
  images: ProductImage[]
  variants: ProductVariant[]
}

export interface Product {
  id: string
  name: string
  slug: string
  section: 'tattoo' | 'pmu' | 'merch'
  active: boolean
  limitedStock: boolean
  madeToOrder?: boolean
  productionDays?: number
  shippingDays?: number
  order: number
  shortDescription?: string
  description?: {
    root: {
      type: string
      children: Array<{
        type: string
        version?: number
        [key: string]: unknown
      }>
      direction: 'ltr' | 'rtl' | null
      format: string
      indent: number
      version: number
    }
    [key: string]: unknown
  } | null
  uniqueNote?: string
  images: ProductImage[]
  videos?: ProductVideo[]
  basePrice: number
  variants: ProductVariant[]
  attributes: ProductAttribute[]
  featureHighlights?: FeatureHighlight[]
  usageSteps?: UsageStep[]
  whatsInTheBox?: WhatsInTheBox[]
  components?: ProductComponent[]
  packs?: ProductPack[]
}

async function fetchAPI<T>(path: string, params?: Record<string, string>, locale?: string, extraHeaders?: Record<string, string>): Promise<T> {
  const url = new URL(`${CMS_API}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  if (locale) url.searchParams.set('locale', locale)
  const res = await fetch(url.toString(), {
    next: { revalidate: 60 }, // ISR — rivalidate ogni 60s
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  })
  if (!res.ok) throw new Error(`CMS fetch error: ${res.status} ${path}`)
  return res.json()
}

export async function getProducts(section?: 'tattoo' | 'pmu' | 'merch', locale = 'it'): Promise<Product[]> {
  const params: Record<string, string> = {
    'where[active][equals]': 'true',
    sort: 'order',
    limit: '100',
  }
  if (section) params['where[section][equals]'] = section
  const data = await fetchAPI<{ docs: Product[] }>('/products', params, locale)
  return data.docs
}

export async function getLimitedProducts(locale = 'it'): Promise<Product[]> {
  const data = await fetchAPI<{ docs: Product[] }>('/products', {
    'where[active][equals]': 'true',
    'where[limitedStock][equals]': 'true',
    sort: 'order',
    limit: '20',
  }, locale)
  return data.docs
}

export async function getProductBySlug(slug: string, locale = 'it'): Promise<Product | null> {
  const data = await fetchAPI<{ docs: Product[] }>('/products', {
    'where[slug][equals]': slug,
    limit: '1',
    depth: '2',
  }, locale)
  return data.docs[0] ?? null
}

/** Restituisce una mappa SKU → URL immagine (prima immagine del prodotto). */
export async function getProductImagesBySku(skus: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(skus.filter(Boolean))]
  if (!unique.length) return {}
  try {
    const res = await fetch(
      `${CMS_API}/products?where[variants.sku][in]=${unique.map(encodeURIComponent).join(',')}&depth=1&limit=50`,
      { cache: 'no-store' }
    )
    if (!res.ok) return {}
    const data = await res.json() as {
      docs: Array<{ variants: Array<{ sku: string }>; images: Array<{ image: { url: string } }> }>
    }
    const map: Record<string, string> = {}
    for (const product of data.docs) {
      const img = product.images[0]?.image?.url
      if (!img) continue
      for (const v of product.variants) {
        if (unique.includes(v.sku)) map[v.sku] = img
      }
    }
    return map
  } catch {
    return {}
  }
}

export interface SubscriptionPlanConfig {
  key: 'tattoo' | 'pmu'
  product: Product
  active: boolean
}

export async function getSubscriptionPlanConfig(key: 'tattoo' | 'pmu', locale = 'it'): Promise<SubscriptionPlanConfig | null> {
  // `subscription-plans` read access requires an authenticated admin OR this shared secret
  // (see cms/src/collections/SubscriptionPlans.ts `hasStorefrontSecret`) — unlike `products`,
  // which is publicly readable. Without this header, anonymous storefront visitors get a 403.
  const data = await fetchAPI<{ docs: SubscriptionPlanConfig[] }>(
    '/subscription-plans',
    { 'where[key][equals]': key, 'where[active][equals]': 'true', depth: '2', limit: '1' },
    locale,
    { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
  )
  return data.docs[0] ?? null
}
