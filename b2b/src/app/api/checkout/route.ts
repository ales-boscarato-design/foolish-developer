import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { createResellerOrder } from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'
import { calculateLineTotal } from '@/lib/pricing'

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const { form, items, total } = await req.json()

  const orderNumber = generateOrderNumber()

  const lineItemsForEmail = items.map((item: {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: []
  }) => ({
    name: `${item.productName} — ${item.variantLabel}`,
    qty: item.qty,
    total: calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
  }))

  await createResellerOrder({
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
    paymentMethod: 'bonifico',
    notes: form.notes,
  })

  await sendOrderConfirmation({
    email: session.email,
    contactName: session.contactName,
    orderNumber,
    total,
    paymentMethod: 'bonifico',
    lineItems: lineItemsForEmail,
  })

  return NextResponse.json({ orderNumber })
}
