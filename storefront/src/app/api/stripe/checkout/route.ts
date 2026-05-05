import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

const STOREFRONT_URL = process.env.STOREFRONT_URL || 'http://localhost:3000'

interface CartItem {
  productName: string
  variantLabel: string
  price: number
  quantity: number
  sku: string
}

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  const { items, shippingCost, customer } = await req.json()
  const orderRef = `FOOLISH-${Date.now()}`

  const lineItems = [
    ...items.map((item: CartItem) => ({
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(item.price * 100),
        product_data: {
          name: `${item.productName} — ${item.variantLabel}`,
          metadata: { sku: item.sku },
        },
      },
      quantity: item.quantity,
    })),
    ...(shippingCost > 0 ? [{
      price_data: {
        currency: 'eur',
        unit_amount: Math.round(shippingCost * 100),
        product_data: { name: 'Spedizione' },
      },
      quantity: 1,
    }] : []),
  ]

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: lineItems,
    customer_email: customer.email,
    billing_address_collection: 'auto',
    shipping_address_collection: {
      allowed_countries: ['IT','DE','FR','ES','NL','BE','AT','CH','PL','PT','SE','DK','NO','US','GB','CA','AU','JP','BR'],
    },
    success_url: `${STOREFRONT_URL}/grazie?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${STOREFRONT_URL}/checkout`,
    metadata: {
      order_ref: orderRef,
      customer_name: customer.name,
      customer_country: customer.country,
      customer_address: `${customer.address}|${customer.city}|${customer.postalCode}`,
      items_json: JSON.stringify(
        items.map((i: CartItem) => ({
          sku: i.sku,
          qty: i.quantity,
          name: i.productName,
          variantLabel: i.variantLabel,
          price: i.price,
        })),
      ),
    },
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
