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
  stockStatus?: string
}

export interface ResellerProduct {
  id: number
  slug: string
  name: string
  /** `active` = visibilita' in vetrina, NON vendibilita' (i kit sono `active: false`). */
  active: boolean
  /** Presenza nel catalogo reseller: e' questa la vendibilita'. */
  resellerVisible: boolean
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
    active: doc.active !== false,
    resellerVisible: doc.resellerVisible !== false,
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

/**
 * Il catalogo autorevole per il checkout: completo e fresco.
 *
 * Perche' non basta `fetchResellerProducts`: le pagine possono (e devono)
 * lavorare su una cache di 60 s, il checkout no. Qui si legge il prezzo
 * corrente, senza cache e con depth 0 (servono solo SKU, prezzi e fasce).
 *
 * Perche' non si filtra per `active`: `active` e' la visibilita' in vetrina,
 * non la vendibilita' (i 6 kit di produzione sono `active: false` ma si
 * vendono). La vendibilita' e' la presenza nel catalogo reseller, quindi il
 * filtro e' solo `resellerVisible`, e `normalizeProduct` conserva il campo
 * per la difesa esplicita del resolver.
 *
 * Un catalogo troncato (`totalDocs` > documenti ricevuti) non e' un
 * catalogo: se il prodotto manca perche' troncato, "SKU sconosciuto"
 * sarebbe una risposta falsa. Meglio fermarsi.
 *
 * Il timeout e' deliberato: un CMS appeso non deve tenere appesa una
 * richiesta di pagamento. `B2B_CATALOG_TIMEOUT_MS` esiste solo per i test e
 * per l'emergenza operativa; il default resta 5 s.
 */
export function catalogTimeoutMs(): number {
  const raw = Number(process.env.B2B_CATALOG_TIMEOUT_MS)
  return Number.isFinite(raw) && raw >= 1 ? raw : 5000
}

export async function fetchResellerCatalog(): Promise<ResellerProduct[]> {
  const url = `${CMS_URL}/api/products?where[resellerVisible][equals]=true&depth=0&limit=200&locale=it`
  const controller = new AbortController()
  // Lo stesso timer copre fetch e lettura del corpo: un CMS che risponde le
  // intestazioni e poi tace non deve tenere appesa una richiesta di pagamento.
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('catalogo_non_disponibile'))
    }, catalogTimeoutMs())
  })
  // La promise puo' scadere mentre stiamo ancora aspettando le intestazioni:
  // senza un handler resterebbe un rifiuto non gestito.
  void timeout.catch(() => {})
  try {
    let res: Response
    try {
      res = await fetch(url, { cache: 'no-store', signal: controller.signal })
    } catch {
      // Errore di rete o timeout: senza catalogo non si sa se il prezzo e'
      // giusto, quindi non si vende.
      throw new Error('catalogo_non_disponibile')
    }
    if (!res.ok) throw new Error('catalogo_non_disponibile')
    let data: { docs?: unknown; totalDocs?: unknown; hasNextPage?: unknown }
    try {
      data = await Promise.race([res.json(), timeout])
    } catch {
      // Parse fallito o scadenza durante la lettura del corpo.
      throw new Error('catalogo_non_disponibile')
    }
    // Il catalogo e' autorevole solo se e' completo e ogni documento e'
    // esattamente visibile ai rivenditori. Un default `true` su un campo
    // assente non e' un'autorizzazione.
    if (
      !data ||
      !Array.isArray(data.docs) ||
      typeof data.totalDocs !== 'number' ||
      !Number.isInteger(data.totalDocs) ||
      data.totalDocs < 0 ||
      data.hasNextPage !== false ||
      data.docs.length !== data.totalDocs ||
      !data.docs.every((doc) => isRecord(doc) && doc.resellerVisible === true)
    ) {
      throw new Error('catalogo_incompleto')
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data.docs as any[]).map(normalizeProduct)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface Announcement {
  id: number
  title: string
  body?: string
  content?: string
  startDate?: string
  endDate?: string
  titleEn?: string
  bodyEn?: string
  contentEn?: string
  titleFr?: string
  bodyFr?: string
  contentFr?: string
  titleEs?: string
  bodyEs?: string
  contentEs?: string
  titleDe?: string
  bodyDe?: string
  contentDe?: string
}

export async function fetchActiveAnnouncement(): Promise<Announcement | null> {
  const nowMs = Date.now()
  const url = `${CMS_URL}/api/announcements?where[active][equals]=true&sort=-updatedAt&limit=10`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    const docs: Announcement[] = data.docs ?? []
    const valid = docs.find(doc => {
      const afterStart = !doc.startDate || new Date(doc.startDate).getTime() <= nowMs
      const beforeEnd = !doc.endDate || new Date(doc.endDate).getTime() >= nowMs
      return afterStart && beforeEnd
    })
    return valid ?? null
  } catch {
    return null
  }
}
