import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { updateB2BPayment } from '@/lib/cms-orders'

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!)
const getWebhookSecret = () => process.env.STRIPE_B2B_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(body, signature, getWebhookSecret())
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const orderNumber = pi.metadata.orderNumber

    if (!orderNumber) {
      console.error('[stripe/webhook] missing orderNumber in metadata:', pi.metadata)
      return NextResponse.json({ error: 'Invalid order metadata' }, { status: 500 })
    }

    try {
      // PATCH through Payload: retries are harmless, and update hooks run.
      // The confirmation email is emitted once by the Payload create hook;
      // the payment webhook only records payment state.
      await updateB2BPayment({ orderNumber, paymentIntentId: pi.id })
    } catch (err) {
      console.error('[stripe/webhook] failed to process payment_intent.succeeded:', err)
      return NextResponse.json({ error: 'Payment processing failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
