import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getServerSession } from '@/lib/auth'
import { checkVatNumber } from '@/lib/vies'
import { ensureB2BAuthTable, findB2BUserByEmail, createB2BUser } from '@/lib/db-auth'
import { createResellerOrder } from '@/lib/db'
import { calculateLineTotal } from '@/lib/pricing'
import { calculateResellerShipping } from '@/lib/shipping'
import type { PriceTier } from '@/lib/cms'

const getStripe = () => new Stripe(process.env.STRIPE_SECRET_KEY!)

function generateOrderNumber(): string {
  const date = new Date()
  const yy = date.getFullYear().toString().slice(-2)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `B2B-${yy}${mm}-${rand}`
}

export async function POST(req: NextRequest) {
  // Stesso trattamento della rotta bonifico (/api/checkout): ospite
  // ammesso, identita' raccolta nel form, partita IVA verificata qui
  // lato server. Aprire una sola delle due strade lasciava il carrello
  // aperto e poi rifiutava chi sceglieva Stripe — cioe' proprio il
  // metodo che vogliamo incoraggiare, visto che i rivenditori hanno
  // gia' un e-commerce e ci convivono ogni giorno.
  const session = await getServerSession()

  const { form, items } = await req.json()

  const email = (session?.email ?? form?.email ?? '').toLowerCase().trim()
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'email_non_valida' }, { status: 400 })
  }
  if (!form?.businessName?.trim()) {
    return NextResponse.json({ error: 'ragione_sociale_mancante' }, { status: 400 })
  }
  const vat = await checkVatNumber(form?.vatNumber ?? '')
  if (vat.status === 'invalid') {
    return NextResponse.json(
      { error: 'partita_iva_non_valida', detail: vat.detail },
      { status: 400 },
    )
  }
  if (!session) {
    try {
      await ensureB2BAuthTable()
      if (!(await findB2BUserByEmail(email))) {
        await createB2BUser(email, form.businessName, null)
      }
    } catch (err) {
      console.error('[stripe/create-intent] creazione account ospite fallita:', err)
    }
  }

  // Totale ricalcolato lato server. Nessun sovrapprezzo: lo storefront
  // retail non ne applica, e caricare un +4% a chi paga con carta
  // spinge verso il bonifico proprio i rivenditori che con Stripe si
  // troverebbero a casa. La commissione la assorbiamo, come nel retail.
  const productsTotal = (items as {
    productName: string; variantLabel: string; qty: number; unitPrice: number; priceTiers: PriceTier[]
  }[]).reduce((sum, item) => sum + calculateLineTotal(item.unitPrice, item.qty, item.priceTiers), 0)
  const shipping = calculateResellerShipping(productsTotal, form.shippingCountry)
  const total = Math.round((productsTotal + shipping.cost) * 100) / 100
  const amountCents = Math.round(total * 100)

  const orderNumber = generateOrderNumber()

  // Create order in DB with pipeline_state = 'received', payment pending
  let orderId: number
  try {
    orderId = await createResellerOrder({
      orderNumber,
      customerEmail: email,
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
      shippingCost: shipping.cost,
      paymentMethod: 'stripe',
      notes: [
        form.notes?.trim(),
        vat.status === 'valid'
          ? `[VIES OK] ${vat.name ?? 'partita IVA valida'}`
          : `[VIES NON VERIFICATA — controllare a mano] ${vat.detail ?? ''}`,
      ].filter(Boolean).join('\n'),
    })
  } catch (err) {
    console.error('[stripe/create-intent] createResellerOrder failed:', err)
    return NextResponse.json({ error: 'Errore creazione ordine' }, { status: 500 })
  }

  let paymentIntent: Stripe.PaymentIntent
  try {
    paymentIntent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      metadata: {
        orderId: String(orderId),
        orderNumber,
        resellerEmail: email,
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
