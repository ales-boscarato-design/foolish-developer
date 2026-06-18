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
  basePrice: number
  priceTiers: PriceTier[]
  variants: ProductVariant[]
  images: { url: string; alt?: string }[]
  description?: string
}

// Payload returns images as array of { image: { url, alt }, alt }
// with depth=1 the upload relation is expanded to a media object
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeProduct(doc: any): ResellerProduct {
  return {
    id: doc.id,
    slug: doc.slug,
    name: doc.name,
    basePrice: doc.basePrice,
    priceTiers: doc.priceTiers ?? [],
    variants: doc.variants ?? [],
    description: doc.description,
    images: (doc.images ?? []).map((item: any) => ({
      url: item.image?.url ?? item.url ?? '',
      alt: item.alt ?? item.image?.alt ?? undefined,
    })).filter((img: { url: string }) => img.url),
  }
}

export async function fetchResellerProducts(): Promise<ResellerProduct[]> {
  const url = `${CMS_URL}/api/products?where[resellerVisible][equals]=true&depth=1&limit=100`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) throw new Error(`CMS error: ${res.status}`)
  const data = await res.json()
  return (data.docs as any[]).map(normalizeProduct)
}

export async function fetchResellerProductBySlug(slug: string): Promise<ResellerProduct | null> {
  const url = `${CMS_URL}/api/products?where[slug][equals]=${slug}&where[resellerVisible][equals]=true&depth=1&limit=1`
  const res = await fetch(url, { next: { revalidate: 60 } })
  if (!res.ok) return null
  const data = await res.json()
  if (!data.docs[0]) return null
  return normalizeProduct(data.docs[0])
}
