import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

async function createOrderInCMS(session: Stripe.Checkout.Session): Promise<void> {
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

  const meta = session.metadata ?? {}
  const orderRef = meta.order_ref ?? `FOOLISH-${session.id}`
  const customerName = meta.customer_name ?? session.customer_details?.name ?? ''
  const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
  const total = (session.amount_total ?? 0) / 100

  let parsedItems: ParsedItem[] = []
  try {
    parsedItems = JSON.parse(meta.items_json ?? '[]')
  } catch {
    // items_json malformato — ordine viene creato comunque
  }

  const itemsTotal = parsedItems.reduce((sum, i) => sum + i.price * i.qty, 0)
  const shippingCost = Math.max(0, parseFloat((total - itemsTotal).toFixed(2)))

  // Indirizzo da Stripe shipping_details (raccolto da Stripe checkout form)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipping = (session as any).shipping_details as {
    address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string }
  } | null
  const shippingAddress = shipping
    ? {
        name: shipping.address ? customerName : '',
        address1: shipping.address?.line1 ?? '',
        address2: shipping.address?.line2 ?? '',
        city: shipping.address?.city ?? '',
        postalCode: shipping.address?.postal_code ?? '',
        country: shipping.address?.country ?? '',
      }
    : (() => {
        // fallback: parsing dal metadata customer_address (address|city|postalCode)
        const parts = (meta.customer_address ?? '').split('|')
        return {
          name: customerName,
          address1: parts[0] ?? '',
          address2: '',
          city: parts[1] ?? '',
          postalCode: parts[2] ?? '',
          country: meta.customer_country ?? '',
        }
      })()

  const lineItems = parsedItems.map((i) => ({
    sku: i.sku,
    name: i.name,
    variantLabel: i.variantLabel,
    quantity: i.qty,
    unitPrice: i.price,
  }))

  // Check if order already exists (Stripe may retry webhooks)
  const existing = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' } },
  )
  if (existing.ok) {
    const existingData = await existing.json()
    if (existingData.docs?.length > 0) return // already created, idempotent
  }

  const res = await fetch(`${cmsUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'storefront',
      customerEmail,
      customerName,
      lineItems,
      total,
      shippingCost,
      shippingAddress,
      pipelineState: 'received',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CMS create order failed ${res.status}: ${text}`)
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('Stripe webhook signature invalid:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    // Crea ordine in Payload CMS
    try {
      await createOrderInCMS(session)
    } catch (err) {
      console.error('CMS order creation failed:', err)
      // Non bloccare la risposta a Stripe — ordine andrà in coda manuale
    }

    // Notifica nanobot
    const nanobotUrl = process.env.NANOBOT_WEBHOOK_URL
    if (nanobotUrl) {
      await fetch(`${nanobotUrl}/hooks/foolish-storefront-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'storefront',
          stripeSessionId: session.id,
          externalRef: session.metadata?.order_ref,
          amount: (session.amount_total ?? 0) / 100,
          currency: session.currency?.toUpperCase(),
          customerEmail: session.customer_email,
          customerName: session.metadata?.customer_name,
          itemsJson: session.metadata?.items_json,
        }),
      }).catch((e) => console.error('nanobot notify failed:', e))
    }
  }

  return NextResponse.json({ received: true })
}
