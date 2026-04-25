/**
 * Payload CMS API client — usato dal server-side Next.js.
 */

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'http://localhost:3001'
const CMS_API = `${CMS_URL}/api`

export interface ProductVariant {
  sku: string
  label: string
  price: number
  dimensions?: string
  thicknessMm?: number
  stockStatus: 'available' | 'low' | 'unavailable'
  limitedQty?: number
}

export interface ProductImage {
  image: { url: string; alt?: string; sizes?: Record<string, { url: string }> }
  alt?: string
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
  description?: unknown // Lexical rich text
  uniqueNote?: string
  images: ProductImage[]
  variants: ProductVariant[]
}

async function fetchAPI<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${CMS_API}${path}`)
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  }
  const res = await fetch(url.toString(), {
    next: { revalidate: 60 }, // ISR — rivalidate ogni 60s
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`CMS fetch error: ${res.status} ${path}`)
  return res.json()
}

export async function getProducts(section?: 'tattoo' | 'pmu'): Promise<Product[]> {
  const params: Record<string, string> = {
    'where[active][equals]': 'true',
    sort: 'order',
    limit: '100',
  }
  if (section) params['where[section][equals]'] = section
  const data = await fetchAPI<{ docs: Product[] }>('/products', params)
  return data.docs
}

export async function getLimitedProducts(): Promise<Product[]> {
  const data = await fetchAPI<{ docs: Product[] }>('/products', {
    'where[active][equals]': 'true',
    'where[limitedStock][equals]': 'true',
    sort: 'order',
    limit: '20',
  })
  return data.docs
}

export async function getProductBySlug(slug: string): Promise<Product | null> {
  const data = await fetchAPI<{ docs: Product[] }>('/products', {
    'where[slug][equals]': slug,
    limit: '1',
  })
  return data.docs[0] ?? null
}
