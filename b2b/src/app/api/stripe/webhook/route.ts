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
    const orderId = parseInt(pi.metadata.orderId, 10)
    const orderNumber = pi.metadata.orderNumber
    const email = pi.metadata.resellerEmail

    if (isNaN(orderId)) {
      console.error('[stripe/webhook] invalid orderId in metadata:', pi.metadata.orderId)
      return NextResponse.json({ received: true })
    }

    try {
      // Idempotency: only process if not already marked as paid
      const updated = await sql<{ id: number }[]>`
        UPDATE orders SET
          notes = COALESCE(notes, '') || ' [Stripe pagato]',
          updated_at = NOW()
        WHERE id = ${orderId}
          AND notes NOT LIKE '%[Stripe pagato]%'
        RETURNING id
      `

      if (updated.length === 0) {
        // Already processed — skip email
        return NextResponse.json({ received: true })
      }

      const rows = await sql<{ customer_name: string; total: number; line_items: unknown }[]>`
        SELECT customer_name, total, line_items FROM orders WHERE id = ${orderId}
      `
      if (rows[0]) {
        const lineItemsRaw = rows[0].line_items as { productName?: string; variantLabel?: string; qty?: number; unitPrice?: number; priceTiers?: [] }[] | null
        const lineItemsForEmail = Array.isArray(lineItemsRaw)
          ? lineItemsRaw.map(i => ({
              name: `${i.productName ?? ''} — ${i.variantLabel ?? ''}`,
              qty: i.qty ?? 0,
              total: (i.unitPrice ?? 0) * (i.qty ?? 0),
            }))
          : []

        await sendOrderConfirmation({
          email,
          contactName: rows[0].customer_name,
          orderNumber,
          total: rows[0].total,
          paymentMethod: 'stripe',
          lineItems: lineItemsForEmail,
        })
      }
    } catch (err) {
      console.error('[stripe/webhook] failed to process payment_intent.succeeded:', err)
      // Return 200 to prevent Stripe from retrying — log the error for manual recovery
    }
  }

  return NextResponse.json({ received: true })
}
