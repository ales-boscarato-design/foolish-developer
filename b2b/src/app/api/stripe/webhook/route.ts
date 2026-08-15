import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import sql from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'
import { calculateLineTotal } from '@/lib/pricing'
import type { PriceTier } from '@/lib/cms'

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
    const orderId = parseInt(pi.metadata.orderId, 10)
    const orderNumber = pi.metadata.orderNumber
    const email = pi.metadata.resellerEmail

    if (isNaN(orderId)) {
      console.error('[stripe/webhook] invalid orderId in metadata:', pi.metadata.orderId)
      return NextResponse.json({ error: 'Invalid order metadata' }, { status: 500 })
    }

    try {
      // Stato pagamento e stato notifica sono separati: se Resend fallisce dopo
      // il primo UPDATE, il retry Stripe deve poter tentare ancora l'email.
      await sql`
        UPDATE orders SET
          notes = COALESCE(notes, '') || ' [Stripe pagato]',
          updated_at = NOW()
        WHERE id = ${orderId}
          AND notes NOT LIKE '%[Stripe pagato]%'
      `

      const rows = await sql<{ customer_name: string; total: number; line_items: unknown; notes: string | null }[]>`
        SELECT customer_name, total, line_items, notes FROM orders WHERE id = ${orderId}
      `
      if (!rows[0]) {
        throw new Error(`Order ${orderId} not found for PaymentIntent ${pi.id}`)
      }

      if (!rows[0].notes?.includes('[Conferma Stripe inviata]')) {
        const lineItemsRaw = rows[0].line_items as { productName?: string; variantLabel?: string; qty?: number; unitPrice?: number; priceTiers?: PriceTier[] }[] | null
        const lineItemsForEmail = Array.isArray(lineItemsRaw)
          ? lineItemsRaw.map(i => ({
              name: `${i.productName ?? ''} — ${i.variantLabel ?? ''}`,
              qty: i.qty ?? 0,
              total: calculateLineTotal(i.unitPrice ?? 0, i.qty ?? 0, i.priceTiers ?? []),
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

        await sql`
          UPDATE orders SET
            notes = COALESCE(notes, '') || ' [Conferma Stripe inviata]',
            updated_at = NOW()
          WHERE id = ${orderId}
            AND notes NOT LIKE '%[Conferma Stripe inviata]%'
        `
      }
    } catch (err) {
      console.error('[stripe/webhook] failed to process payment_intent.succeeded:', err)
      return NextResponse.json({ error: 'Payment processing failed' }, { status: 500 })
    }
  }

  return NextResponse.json({ received: true })
}
