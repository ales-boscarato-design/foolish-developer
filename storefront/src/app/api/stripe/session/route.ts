import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId)

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 402 })
    }

    const orderRef = session.metadata?.order_ref ?? null
    const customerName = session.metadata?.customer_name ?? session.customer_details?.name ?? ''
    const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
    const total = session.amount_total ? session.amount_total / 100 : 0

    const rawLineItems = session.line_items?.data ?? []
    const lineItems = rawLineItems as Array<{ description?: string; quantity?: number; amount_total?: number }>
    const items = lineItems
      .filter((li) => !li.description?.toLowerCase().includes('spedizione') && !li.description?.toLowerCase().includes('shipping'))
      .map((li) => ({
        name: li.description ?? 'Prodotto',
        quantity: li.quantity ?? 1,
        unitAmount: 0,
      }))

    const shippingCost = lineItems
      .filter((li) => li.description?.toLowerCase().includes('spedizione') || li.description?.toLowerCase().includes('shipping'))
      .reduce((sum, li) => sum + ((li.amount_total ?? 0) / 100), 0)

    return NextResponse.json({
      orderRef,
      customerName,
      customerEmail,
      total,
      items,
      shippingCost,
      paymentStatus: session.payment_status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
