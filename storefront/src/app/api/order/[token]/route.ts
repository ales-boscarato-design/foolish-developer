import { cmsServiceSecret } from '@/lib/cms-service-secret'
import { NextRequest, NextResponse } from 'next/server'
import { parseDeliveryPromise } from '@/lib/delivery-promise'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const API_SECRET = cmsServiceSecret()

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!token || token.length < 10) {
    return NextResponse.json({ error: 'invalid token' }, { status: 400 })
  }

  const url = `${CMS_URL}/api/orders?where[pageToken][equals]=${encodeURIComponent(token)}&depth=0&limit=1`

  let data: Record<string, unknown>
  try {
    const res = await fetch(url, {
      headers: { 'x-storefront-secret': API_SECRET },
      next: { revalidate: 60 },
    })
    if (!res.ok) throw new Error(`CMS ${res.status}`)
    data = await res.json()
  } catch (err) {
    console.error('[order-page] CMS fetch failed:', err)
    return NextResponse.json({ error: 'unavailable' }, { status: 503 })
  }

  const docs = (data as { docs?: unknown[] }).docs
  if (!docs || docs.length === 0) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const order = docs[0] as Record<string, unknown>

  // Restituisce solo i campi sicuri per la pagina pubblica
  return NextResponse.json({
    orderNumber:       order.orderNumber,
    customerName:      order.customerName,
    customerLocale:    order.customerLocale,
    pipelineState:     order.pipelineState,
    productionEtaDays: order.productionEtaDays,
    // Snapshot della promessa, gia' validato: la pagina pubblica mostra la data
    // congelata al pagamento e non ricalcola niente. `null` per gli ordini
    // storici e per quelli in cui nessuna data e' stata promessa.
    deliveryPromise:   parseDeliveryPromise(order.deliveryPromise),
    trackingNumber:    order.trackingNumber,
    trackingCarrier:   order.trackingCarrier,
    shippedAt:         order.shippedAt,
    deliveredAt:       order.deliveredAt,
    createdAt:         order.createdAt,
    lineItems:         order.lineItems,
    sheetPhotos:       order.sheetPhotos   ?? [],
    contentBlocks:     (order.contentBlocks as unknown[] ?? []).filter(
      (b) => (b as Record<string, unknown>).active !== false &&
             (!((b as Record<string, unknown>).expiresAt) ||
              new Date((b as Record<string, unknown>).expiresAt as string) > new Date())
    ),
  })
}
