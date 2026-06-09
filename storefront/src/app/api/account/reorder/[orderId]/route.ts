import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import Stripe from 'stripe'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  const { orderId } = await params
  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL

  // Fetch order from CMS
  const orderRes = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${orderId}&where[customerEmail][equals]=${encodeURIComponent(session.email)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET! } }
  )
  if (!orderRes.ok) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const orderData = await orderRes.json()
  const order = orderData.docs?.[0]
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const lineItems = order.lineItems as { name: string; variantLabel?: string; quantity: number; unitPrice: number }[]

  // Build Stripe line items using price_data (no stored price IDs needed)
  const stripeItems = lineItems.map((item) => ({
    price_data: {
      currency: 'eur',
      unit_amount: Math.round(item.unitPrice * 100),
      product_data: {
        name: item.variantLabel ? `${item.name} — ${item.variantLabel}` : item.name,
      },
    },
    quantity: item.quantity,
  }))

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: stripeItems,
    success_url: `${process.env.STOREFRONT_URL}/account/ordini?reorder=success`,
    cancel_url: `${process.env.STOREFRONT_URL}/account`,
    customer_email: session.email,
    metadata: {
      reorder_from: orderId,
      customer_email: session.email,
    },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
