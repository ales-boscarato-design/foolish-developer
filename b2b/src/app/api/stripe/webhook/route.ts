import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { updateB2BPayment } from '@/lib/cms-orders'
import { getB2BOrderNumber } from '@/lib/stripe-webhook'

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
    const orderNumber = getB2BOrderNumber(pi.metadata)

    if (!orderNumber) {
      // The Stripe account can deliver Storefront payment events to this
      // endpoint as well. They are not B2B payments and must be acknowledged
      // so Stripe does not retry them indefinitely.
      console.warn('[stripe/webhook] ignoring payment_intent.succeeded without B2B orderNumber:', pi.id)
      return NextResponse.json({ received: true, ignored: true })
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
