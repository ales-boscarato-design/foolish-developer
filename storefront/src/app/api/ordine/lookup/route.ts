import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'
const CMS_SECRET = process.env.PAYLOAD_API_SECRET || ''

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const orderNumber = searchParams.get('orderNumber')
  const email = searchParams.get('email')

  if (!orderNumber || !email) {
    return NextResponse.json({ error: 'orderNumber and email are required' }, { status: 400 })
  }

  if (!CMS_SECRET) {
    return NextResponse.json({ error: 'CMS API token not configured' }, { status: 503 })
  }

  try {
    const res = await fetch(
      `${CMS_URL}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderNumber)}&where[customerEmail][equals]=${encodeURIComponent(email)}&depth=1`,
      {
        headers: {
          'x-storefront-secret': CMS_SECRET,
          'Content-Type': 'application/json',
        },
        next: { revalidate: 0 },
      },
    )

    if (!res.ok) {
      return NextResponse.json({ error: 'CMS unavailable' }, { status: 502 })
    }

    const data = await res.json()
    const orders = data.docs ?? []

    if (orders.length === 0) {
      return NextResponse.json({ found: false })
    }

    const order = orders[0]

    const items = Array.isArray(order.lineItems) ? order.lineItems : []

    return NextResponse.json({
      found: true,
      order: {
        orderNumber: order.orderNumber,
        customerName: order.customerName ?? '',
        customerEmail: order.customerEmail,
        total: order.total,
        shippingCost: order.shippingCost ?? 0,
        pipelineState: order.pipelineState ?? 'received',
        trackingNumber: order.trackingNumber ?? null,
        trackingCarrier: order.trackingCarrier ?? null,
        productionEtaDays: order.productionEtaDays ?? null,
        shippingAddress: order.shippingAddress ?? null,
        items,
        createdAt: order.createdAt,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
