/**
 * Payload CMS API client — usato dal server-side Next.js.
 */

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001'
const CMS_API = `${CMS_URL}/api`

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
  section: 'tattoo' | 'pmu'
  active: boolean
  limitedStock: boolean
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
  basePrice: number
  variants: ProductVariant[]
  attributes: ProductAttribute[]
  featureHighlights?: FeatureHighlight[]
  usageSteps?: UsageStep[]
  whatsInTheBox?: WhatsInTheBox[]
  components?: ProductComponent[]
}

async function fetchAPI<T>(path: string, params?: Record<string, string>, locale?: string): Promise<T> {
  const url = new URL(`${CMS_API}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  if (locale) url.searchParams.set('locale', locale)
  const res = await fetch(url.toString(), {
    next: { revalidate: 60 }, // ISR — rivalidate ogni 60s
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`CMS fetch error: ${res.status} ${path}`)
  return res.json()
}

export async function getProducts(section?: 'tattoo' | 'pmu', locale = 'it'): Promise<Product[]> {
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
