const CMS_URL = process.env.CMS_URL!

export interface PriceTier {
  minQty: number
  maxQty: number | null
  discountPercent: number
}

export interface ProductVariant {
  id: string
  sku: string
  label: string
  price: number
}

export interface ResellerProduct {
  id: number
  slug: string
  name: string
  section: 'tattoo' | 'pmu' | 'kit'
  basePrice: number
  priceTiers: PriceTier[]
  variants: ProductVariant[]
  images: { url: string; alt?: string }[]
  uniqueNote?: string
  resellerDescription?: string
  resellerQtyPresets?: string
}

// Payload returns images as array of { image: { url, alt }, alt }
// with depth=1 the upload relation is expanded to a media object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProduct(doc: any): ResellerProduct {
  return {
    id: doc.id,
    slug: doc.slug,
    name: doc.name,
    section: doc.section,
    basePrice: doc.basePrice,
    priceTiers: doc.priceTiers ?? [],
    variants: doc.variants ?? [],
    uniqueNote: typeof doc.uniqueNote === 'string' ? doc.uniqueNote : undefined,
    resellerDescription: typeof doc.resellerDescription === 'string' ? doc.resellerDescription : undefined,
    resellerQtyPresets: typeof doc.resellerQtyPresets === 'string' ? doc.resellerQtyPresets : undefined,
    images: (doc.images ?? []).map((item: any) => ({
      url: item.image?.url ?? item.url ?? '',
      alt: item.alt ?? item.image?.alt ?? undefined,
    })).filter((img: { url: string }) => img.url),
  }
}

export async function fetchResellerProducts(locale = 'it'): Promise<ResellerProduct[]> {
  const url = `${CMS_URL}/api/products?where[resellerVisible][equals]=true&depth=1&limit=100&locale=${locale}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`CMS error: ${res.status}`)
  const data = await res.json()
  return (data.docs as any[]).map(normalizeProduct)
}

export async function fetchResellerProductBySlug(slug: string, locale = 'it'): Promise<ResellerProduct | null> {
  const url = `${CMS_URL}/api/products?where[slug][equals]=${encodeURIComponent(slug)}&where[resellerVisible][equals]=true&depth=1&limit=1&locale=${locale}`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.docs[0]) return null
  return normalizeProduct(data.docs[0])
}
