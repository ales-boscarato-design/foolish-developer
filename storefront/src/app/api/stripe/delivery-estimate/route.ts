import { NextRequest, NextResponse } from 'next/server'
import { resolveCheckoutCatalog } from '@/lib/catalog'
import { estimateCartDelivery } from '@/lib/delivery-estimate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }
  const { items, country } = body as { items?: unknown; country?: unknown }
  if (typeof country !== 'string' || !/^[A-Z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'destination_required' }, { status: 400 })
  }
  const catalog = await resolveCheckoutCatalog(items)
  if (catalog.status === 'unavailable') return NextResponse.json({ error: 'catalog_unavailable' }, { status: 503 })
  if (catalog.status !== 'ok') return NextResponse.json({ error: 'invalid_cart' }, { status: 400 })

  // Stesso calcolo del checkout: zona, articolo piu' lento della produzione e
  // margine (noto o prudente) vengono da `estimateCartDelivery`, mai da una
  // copia locale che potrebbe divergere dalla data incassata.
  const estimate = estimateCartDelivery({ country, items: catalog.items })
  if (estimate.zone === null) {
    return NextResponse.json({ error: 'destination_required' }, { status: 400 })
  }
  return NextResponse.json({
    deliveryEstimateDate: estimate.date,
    zone: estimate.zone,
    productionDays: estimate.productionDays,
  })
}
