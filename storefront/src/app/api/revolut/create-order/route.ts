import { NextRequest, NextResponse } from 'next/server'

const REVOLUT_API = process.env.REVOLUT_MODE === 'live'
  ? 'https://merchant.revolut.com/api/1.0'
  : 'https://sandbox-merchant.revolut.com/api/1.0'

export async function POST(req: NextRequest) {
  const apiKey = process.env.REVOLUT_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Revolut API key non configurata. Aggiungila nelle env vars.' },
      { status: 503 },
    )
  }

  const body = await req.json()
  const { items, shippingCost, total, customer } = body

  // Crea ordine Revolut
  const orderPayload = {
    amount: Math.round(total * 100), // centesimi
    currency: 'EUR',
    capture_mode: 'AUTOMATIC',
    merchant_order_ext_ref: `FOOLISH-${Date.now()}`,
    customer_email: customer.email,
    shipping_address: {
      street_line_1: customer.address,
      city: customer.city,
      postcode: customer.postalCode,
      country_code: customer.country,
    },
    metadata: {
      customer_name: customer.name,
      items: JSON.stringify(items.map((i: { sku: string; quantity: number; productName: string }) => ({
        sku: i.sku,
        qty: i.quantity,
        name: i.productName,
      }))),
      shipping_cost: shippingCost,
    },
  }

  const res = await fetch(`${REVOLUT_API}/orders`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(orderPayload),
  })

  if (!res.ok) {
    const err = await res.text()
    console.error('Revolut order creation failed:', err)
    return NextResponse.json({ error: 'Errore pagamento' }, { status: 502 })
  }

  const order = await res.json()
  // Ritorna il public_id per il widget JS Revolut embedded
  return NextResponse.json({
    publicId: order.public_id,
    orderId: order.id,
  })
}
