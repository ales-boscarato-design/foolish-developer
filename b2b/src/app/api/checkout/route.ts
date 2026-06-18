import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from '@/lib/auth'
import { createResellerOrder } from '@/lib/db'
import { sendOrderConfirmation } from '@/lib/resend'
import { calculateLineTotal } from '@/lib/pricing'
import type { PriceTier } from '@/lib/cms'

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

  // Recalculate total server-side — never trust client-supplied amounts
  const lineItemsForEmail = (items as {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: PriceTier[]
  }[]).map(item => ({
    name: `${item.productName} — ${item.variantLabel}`,
    qty: item.qty,
    total: calculateLineTotal(item.unitPrice, item.qty, item.priceTiers),
  }))
  const serverTotal = lineItemsForEmail.reduce((sum, i) => sum + i.total, 0)

  const orderNumber = generateOrderNumber()

  try {
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
      total: serverTotal,
      shippingCost: 0,
      paymentMethod: 'bonifico',
      notes: form.notes,
    })
  } catch (err) {
    console.error('[checkout] createResellerOrder failed:', err)
    return NextResponse.json({ error: 'Errore creazione ordine' }, { status: 500 })
  }

  try {
    await sendOrderConfirmation({
      email: session.email,
      contactName: session.contactName,
      orderNumber,
      total: serverTotal,
      paymentMethod: 'bonifico',
      lineItems: lineItemsForEmail,
    })
  } catch (err) {
    console.error('[checkout] sendOrderConfirmation failed:', err)
    // Order is already saved — don't fail the request
  }

  return NextResponse.json({ orderNumber })
}
