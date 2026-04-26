import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

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
