import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

function verifySignature(payload: string, signature: string, secret: string): boolean {
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}

export async function POST(req: NextRequest) {
  const secret = process.env.REVOLUT_WEBHOOK_SECRET
  if (!secret) {
    console.error('REVOLUT_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('revolut-signature') ?? ''

  if (!verifySignature(rawBody, signature, secret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const { event: eventType, order } = event

  if (eventType === 'ORDER_COMPLETED') {
    // Notifica nanobot via HTTP interno
    const nanobotUrl = process.env.NANOBOT_WEBHOOK_URL
    if (nanobotUrl) {
      await fetch(`${nanobotUrl}/hooks/foolish-storefront-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'storefront',
          revolutOrderId: order.id,
          externalRef: order.merchant_order_ext_ref,
          amount: order.order_amount.value / 100,
          currency: order.order_amount.currency,
          customerEmail: order.email,
          shippingAddress: order.shipping_address,
          metadata: order.metadata,
        }),
      }).catch((e) => console.error('nanobot notify failed:', e))
    }
  }

  return NextResponse.json({ received: true })
}
