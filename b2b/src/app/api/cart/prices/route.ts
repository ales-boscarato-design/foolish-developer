import { NextRequest, NextResponse } from 'next/server'

import { fetchResellerCatalog, type PriceTier, type ResellerProduct } from '@/lib/cms'
import { lineTotalCents, MAX_LINES, MAX_QTY } from '@/lib/b2b-pricing'

/**
 * POST /api/cart/prices — prezzi autorevoli per le righe del carrello.
 *
 * Sola lettura: rilegge il catalogo con lo stesso fetcher fail-closed del
 * checkout e restituisce il prezzo corrente per ogni SKU richiesto. Non crea
 * ordini, non crea PaymentIntent, non chiama Stripe e non scrive nulla.
 *
 * La pagina la chiama solo dopo un rifiuto per prezzo/fasce/prodotto, per
 * mostrare al cliente il prezzo nuovo e lasciargli decidere. Non e' un
 * percorso di acquisto: e' un preventivo di riallineamento.
 */

interface RequestedLine {
  variantSku: string
  qty: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Il corpo e' valido solo se ogni riga espone esattamente cio' che serve. */
function readRequestedLines(body: unknown): RequestedLine[] | null {
  if (!isRecord(body)) return null
  const rawItems = body.items
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_LINES) {
    return null
  }

  const lines: RequestedLine[] = []
  for (const raw of rawItems) {
    if (!isRecord(raw)) return null
    const variantSku = raw.variantSku
    const qty = raw.qty
    if (typeof variantSku !== 'string') return null
    const sku = variantSku.trim()
    if (!sku) return null
    if (
      typeof qty !== 'number' ||
      !Number.isFinite(qty) ||
      !Number.isInteger(qty) ||
      qty < 1 ||
      qty > MAX_QTY
    ) {
      return null
    }
    lines.push({ variantSku: sku, qty })
  }
  return lines
}

function findVariant(
  catalog: ResellerProduct[],
  sku: string,
): { product: ResellerProduct; variant: ResellerProduct['variants'][number] } | null {
  for (const product of catalog) {
    for (const variant of product.variants) {
      if (variant.sku === sku) return { product, variant }
    }
  }
  return null
}

/** Un prezzo e' utilizzabile solo se e' un importo esatto in centesimi. */
function readPrice(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null
  const cents = raw * 100
  if (Math.abs(cents - Math.round(cents)) >= 1e-6) return null
  return raw
}

/**
 * Fasce in forma canonica. Una fascia ambigua (sovrapposta, sconto fuori
 * scala) non e' un prezzo: si preferisce un 503 a un totale inventato.
 */
function readTiers(raw: unknown): PriceTier[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw)) return null
  const tiers: PriceTier[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const { minQty, discountPercent } = entry
    const maxQty = entry.maxQty === undefined || entry.maxQty === null ? null : entry.maxQty
    if (typeof minQty !== 'number' || !Number.isInteger(minQty) || minQty < 1) return null
    if (
      maxQty !== null &&
      (typeof maxQty !== 'number' || !Number.isInteger(maxQty) || maxQty < minQty)
    ) {
      return null
    }
    if (
      typeof discountPercent !== 'number' ||
      !Number.isFinite(discountPercent) ||
      discountPercent < 0 ||
      discountPercent > 100
    ) {
      return null
    }
    tiers.push({ minQty, maxQty, discountPercent })
  }
  for (let i = 1; i < tiers.length; i += 1) {
    const previous = tiers[i - 1]
    if (previous.maxQty === null || tiers[i].minQty <= previous.maxQty) return null
  }
  return tiers
}

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'righe_non_valide' }, { status: 400 })
  }

  const requested = readRequestedLines(body)
  if (!requested) {
    return NextResponse.json({ error: 'righe_non_valide' }, { status: 400 })
  }

  let catalog: ResellerProduct[]
  try {
    catalog = await fetchResellerCatalog()
  } catch (err) {
    console.error('[cart-prices] catalogo non disponibile:', err)
    return NextResponse.json({ error: 'catalogo_non_disponibile' }, { status: 503 })
  }

  const items: Array<{
    variantSku: string
    qty: number
    available: boolean
    unitPrice: number | null
    priceTiers: PriceTier[]
    lineTotalCents: number
  }> = []
  let productsTotalCents = 0

  for (const line of requested) {
    const match = findVariant(catalog, line.variantSku)
    if (!match) {
      items.push({
        variantSku: line.variantSku,
        qty: line.qty,
        available: false,
        unitPrice: null,
        priceTiers: [],
        lineTotalCents: 0,
      })
      continue
    }

    const unitPrice = readPrice(match.variant.price)
    const tiers = readTiers(match.product.priceTiers)
    if (unitPrice === null || tiers === null) {
      // Il catalogo e' leggibile ma non affidabile su questa riga: meglio
      // fermarsi che mostrare un prezzo che non possiamo difendere.
      return NextResponse.json({ error: 'catalogo_non_valido' }, { status: 503 })
    }

    const lineCents = lineTotalCents(unitPrice, line.qty, tiers)
    productsTotalCents += lineCents
    items.push({
      variantSku: line.variantSku,
      qty: line.qty,
      available: match.variant.stockStatus !== 'unavailable',
      unitPrice,
      priceTiers: tiers,
      lineTotalCents: lineCents,
    })
  }

  return NextResponse.json({ productsTotalCents, items })
}
