import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { cmsServiceSecret } from '@/lib/cms-service-secret'
import { parseDeliveryPromise, parseDeliveryPromiseMetadataValue } from '@/lib/delivery-promise'

export const dynamic = 'force-dynamic'

const CMS_URL = () => process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'

/**
 * La promessa di consegna da mostrare nella conferma d'ordine.
 *
 * Si legge l'ORDINE CMS, che e' la fonte che tutte le altre schermate
 * post-pagamento leggono. Se il CMS non risponde si usa lo snapshot scritto nei
 * metadata della sessione: e' lo stesso valore, congelato alla creazione del
 * pagamento. In nessuno dei due casi la data viene ricalcolata con le
 * festivita', i `productionDays` o l'indirizzo di oggi.
 */
async function readFrozenDeliveryPromise(
  orderRef: string | null,
  sessionMetadata: Stripe.Metadata | null | undefined,
): Promise<ReturnType<typeof parseDeliveryPromise>> {
  const fromSession = parseDeliveryPromiseMetadataValue(sessionMetadata?.delivery_promise)
  const secret = cmsServiceSecret()
  if (!orderRef || !secret) return fromSession

  try {
    const res = await fetch(
      `${CMS_URL()}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&depth=0&limit=1`,
      { headers: { 'x-storefront-secret': secret }, cache: 'no-store' },
    )
    if (!res.ok) return fromSession
    const data = await res.json() as { docs?: Array<{ deliveryPromise?: unknown }> }
    return parseDeliveryPromise(data.docs?.[0]?.deliveryPromise) ?? fromSession
  } catch {
    return fromSession
  }
}

export async function GET(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const sessionId = req.nextUrl.searchParams.get('session_id')
  if (!sessionId) {
    return NextResponse.json({ error: 'session_id required' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['line_items.data.price'],
    })

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ error: 'Payment not completed' }, { status: 402 })
    }

    const orderRef = session.metadata?.order_ref ?? null
    const customerName = session.metadata?.customer_name ?? session.customer_details?.name ?? ''
    const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
    const total = session.amount_total ? session.amount_total / 100 : 0

    const rawLineItems = session.line_items?.data ?? []
    const lineItems = rawLineItems as Array<{ description?: string; quantity?: number; amount?: number; amount_total?: number; price?: { unit_amount?: number } }>
    const items = lineItems
      .filter((li) => !li.description?.toLowerCase().includes('spedizione') && !li.description?.toLowerCase().includes('shipping'))
      .map((li) => {
        const qty = li.quantity ?? 1
        const unitAmount = li.price?.unit_amount != null
          ? li.price.unit_amount / 100
          : (li.amount_total ?? li.amount ?? 0) / 100 / qty
        return {
          name: li.description ?? 'Prodotto',
          quantity: qty,
          unitAmount,
        }
      })

    const shippingCost = lineItems
      .filter((li) => li.description?.toLowerCase().includes('spedizione') || li.description?.toLowerCase().includes('shipping'))
      .reduce((sum, li) => sum + ((li.amount_total ?? li.amount ?? 0) / 100), 0)

    const deliveryPromise = await readFrozenDeliveryPromise(orderRef, session.metadata)

    return NextResponse.json({
      orderRef,
      customerName,
      customerEmail,
      total,
      items,
      shippingCost,
      deliveryPromise,
      paymentStatus: session.payment_status,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
