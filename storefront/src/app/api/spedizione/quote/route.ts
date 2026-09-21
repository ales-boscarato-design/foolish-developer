/**
 * Prezzo della riga "spedizione e import" per una destinazione extra-UE.
 *
 * Perche' esiste: la chiave API Packlink vive solo sulla Pi di Alfred, quindi il
 * browser non puo' chiedere la quota direttamente. Il negozio fa da tramite
 * server-to-server (segreto in una variabile d'ambiente) e restituisce al
 * carrello il PREZZO, non il costo: la scomposizione del costo non esce dal
 * server se non per i campi che servono a mostrare l'avviso.
 *
 * Lo stesso percorso di risoluzione e' usato dal checkout: quello che il cliente
 * vede e quello che paga nascono dallo stesso calcolo (`resolveExtraEuShipping`).
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveCheckoutCatalog } from '@/lib/catalog'
import { cartSubtotalCents, normalizeCheckoutItems } from '@/lib/promo'
import { getShippingZone, isAllowedShippingCountry } from '@/lib/shipping'
import {
  cartFingerprint,
  resolveExtraEuShipping,
  signQuoteToken,
  type ExtraEuShippingResolution,
} from '@/lib/landed-cost'

export const dynamic = 'force-dynamic'

/** Il servizio di quota crea documenti doganali: non e' spammabile. */
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX = 40
/** Cache breve: assorbe i cambi di indirizzo del checkout senza ribattere la Pi. */
const CACHE_TTL_MS = 60_000

interface CacheEntry {
  resolution: ExtraEuShippingResolution
  expiresAt: number
}

const quoteCache = new Map<string, CacheEntry>()
const rateLimitHits = new Map<string, number[]>()

function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for') || ''
  const first = forwarded.split(',')[0]?.trim()
  return first && first.length <= 64 ? first : 'unknown'
}

function isRateLimited(key: string, now: number): boolean {
  const hits = (rateLimitHits.get(key) ?? []).filter((stamp) => now - stamp < RATE_LIMIT_WINDOW_MS)
  if (hits.length >= RATE_LIMIT_MAX) {
    rateLimitHits.set(key, hits)
    return true
  }
  hits.push(now)
  rateLimitHits.set(key, hits)
  return false
}

function readCache(key: string, now: number): ExtraEuShippingResolution | null {
  const entry = quoteCache.get(key)
  if (!entry) return null
  if (entry.expiresAt <= now) {
    quoteCache.delete(key)
    return null
  }
  return entry.resolution
}

function writeCache(key: string, resolution: ExtraEuShippingResolution, now: number): void {
  if (quoteCache.size > 500) quoteCache.clear()
  quoteCache.set(key, { resolution, expiresAt: now + CACHE_TTL_MS })
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Richiesta non valida' }, { status: 400 })
  }

  const request = body as { country?: unknown; city?: unknown; postalCode?: unknown; items?: unknown }
  const country = boundedString(request.country, 2)?.toUpperCase()
  if (!country || !isAllowedShippingCountry(country)) {
    return NextResponse.json({ error: 'Destinazione non ammessa' }, { status: 400 })
  }
  if (getShippingZone(country) !== 'EXTRA_EU') {
    // UE e Italia non hanno sdoganamento: la tariffa e' quella del corriere e
    // la calcola il carrello dal modulo di spedizione, senza toccare la Pi.
    return NextResponse.json({ error: 'Destinazione senza sdoganamento' }, { status: 400 })
  }

  // Il carrello e' risolto sul catalogo CMS: sku e quantita' del browser non
  // sono autorevoli, e il valore della merce che entra nel calcolo del profilo
  // deve venire dal catalogo, non dal client.
  const catalog = await resolveCheckoutCatalog(request.items)
  if (catalog.status === 'unavailable') {
    return NextResponse.json({ error: 'Catalogo temporaneamente non disponibile' }, { status: 503 })
  }
  if (catalog.status !== 'ok') {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }
  const items = normalizeCheckoutItems(catalog.items)
  if (!items) {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }
  const subtotalCents = cartSubtotalCents(items)
  if (subtotalCents === null || subtotalCents <= 0) {
    return NextResponse.json({ error: 'Carrello non valido' }, { status: 400 })
  }

  // Un carrello con pack: lo sku del pack non e' uno sku di variante, e il
  // servizio di quota non lo conosce. Meglio nessuna quota che una quota su un
  // carrello piu' piccolo di quello che si paga.
  const hasPackLine = items.some((item) => item.sku.includes('-pack-'))
  if (hasPackLine) {
    return NextResponse.json(
      { error: 'Per questo carrello la spedizione si quota con la base prudenziale' },
      { status: 409 },
    )
  }

  const now = Date.now()
  if (isRateLimited(clientKey(req), now)) {
    return NextResponse.json({ error: 'Troppe richieste' }, { status: 429 })
  }

  const city = boundedString(request.city, 80) ?? ''
  const postalCode = boundedString(request.postalCode, 16) ?? ''
  const fingerprint = cartFingerprint(items, country)
  const cacheKey = `${fingerprint}:${subtotalCents}`

  let resolution = readCache(cacheKey, now)
  if (!resolution) {
    resolution = await resolveExtraEuShipping({
      countryCode: country,
      goodsCents: subtotalCents,
      destination: { zip: postalCode, city },
      items: items.map((item) => ({ sku: item.sku, quantity: item.quantity })),
    })
    if (!resolution) {
      return NextResponse.json(
        { error: 'Per questa destinazione non esiste una base di prezzo: non si vende' },
        { status: 409 },
      )
    }
    writeCache(cacheKey, resolution, now)
  }

  const quoteToken = signQuoteToken({
    countryCode: country,
    fingerprint,
    costCents: resolution.costCents,
  })

  return NextResponse.json({
    country,
    costCents: resolution.costCents,
    source: resolution.source,
    verified: resolution.verified,
    // Il costo e il margine restano sul server: al browser serve il PREZZO, non
    // da cosa e' composto il nostro margine.
    minimumChargeApplied: resolution.minimumChargeApplied,
    checkoutInvoiceNumber: resolution.quote?.checkoutInvoiceNumber ?? null,
    quoteExpiresAt: resolution.quote?.expiresAt ?? null,
    quoteToken,
  })
}
