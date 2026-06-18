import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getServerSession } from '@/lib/auth'
import { createResellerOrder } from '@/lib/db'
import { calculateLineTotal } from '@/lib/pricing'
import type { PriceTier } from '@/lib/cms'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  const session = await getServerSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { form, items } = await req.json()

  // Recalculate total server-side, then apply +4% surcharge
  const baseTotal = (items as {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: PriceTier[]
  }[]).reduce((sum, item) => sum + calculateLineTotal(item.unitPrice, item.qty, item.priceTiers), 0)
  const total = Math.round(baseTotal * 1.04 * 100) / 100
  const amountCents = Math.round(total * 100)

  const orderNumber = generateOrderNumber()

  // Create order in DB with pipeline_state = 'received', payment pending
  let orderId: number
  try {
    orderId = await createResellerOrder({
      orderNumber,
      customerEmail: session.email,
      customerName: form.shippingName,
      vatNumber: form.vatNumber,
      businessName: form.businessName,
      sdiCode: form.sdiCode,
      billingAddress1: form.billingAddress1,
      billingCity: form.billingCity,
      billingPostalCode: form.billingPostalCode,
      billingCountry: form.billingCountry,
      shippingAddressName: form.shippingName,
      shippingAddress1: form.shippingAddress1,
      shippingCity: form.shippingCity,
      shippingPostalCode: form.shippingPostalCode,
      shippingCountry: form.shippingCountry,
      lineItems: items,
      total,
      shippingCost: 0,
      paymentMethod: 'stripe',
      notes: `${form.notes ?? ''} [Stripe +4%]`.trim(),
    })
  } catch (err) {
    console.error('[stripe/create-intent] createResellerOrder failed:', err)
    return NextResponse.json({ error: 'Errore creazione ordine' }, { status: 500 })
  }

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      metadata: {
        orderId: String(orderId),
        orderNumber,
        resellerEmail: session.email,
      },
      automatic_payment_methods: { enabled: true },
    })
  } catch (err) {
    console.error('[stripe/create-intent] stripe.paymentIntents.create failed (orderId=%s):', orderId, err)
    return NextResponse.json({ error: 'Errore pagamento' }, { status: 502 })
  }

  return NextResponse.json({
    clientSecret: paymentIntent.client_secret,
    orderId,
    orderNumber,
  })
}
