import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import sql from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
const webhookSecret = process.env.STRIPE_B2B_WEBHOOK_SECRET!

export async function POST(req: NextRequest) {
  const body = await req.text()
  const signature = req.headers.get('stripe-signature')!

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object as Stripe.PaymentIntent
    const orderId = pi.metadata.orderId
    const orderNumber = pi.metadata.orderNumber
    const email = pi.metadata.resellerEmail

    try {
      await sql`
        UPDATE orders SET
          notes = COALESCE(notes, '') || ' [Stripe pagato]',
          updated_at = NOW()
        WHERE id = ${orderId}
      `

      const rows = await sql<{ customer_name: string; total: number }[]>`
        SELECT customer_name, total FROM orders WHERE id = ${orderId}
      `
      if (rows[0]) {
        await sendOrderConfirmation({
          email,
          contactName: rows[0].customer_name,
          orderNumber,
          total: rows[0].total,
          paymentMethod: 'stripe',
          lineItems: [],
        })
      }
    } catch (err) {
      console.error('[stripe/webhook] failed to process payment_intent.succeeded:', err)
      // Return 200 to prevent Stripe from retrying — log the error for manual recovery
    }
  }

  return NextResponse.json({ received: true })
}
