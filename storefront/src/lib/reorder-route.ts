import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import { buildReorderCheckoutSessionParams, buildReorderPlan, type ReorderFailureReason } from './reorder'

/**
 * Corpo del riordino dall'area account.
 *
 * Sta in `lib` e non nella route per una ragione pratica: `getSession()` legge i
 * cookie del contesto richiesta Next e non e' invocabile da un test Node. Qui
 * l'email dell'account arriva come argomento, quindi il percorso che tocca i soldi
 * (lookup ordine, tariffa, sessione Stripe) e' coperto da un test di route vero.
 * La route resta il guscio: autenticazione + estrazione del parametro.
 */

const FAILURES: Record<ReorderFailureReason, { status: number; error: string }> = {
  order_unusable: {
    status: 400,
    error: 'Questo ordine non può essere riordinato dall’area account: usa il checkout.',
  },
  items_missing: {
    status: 400,
    error: 'Questo ordine non può essere riordinato dall’area account: usa il checkout.',
  },
  address_incomplete: {
    status: 400,
    error: 'L’indirizzo di spedizione di questo ordine è incompleto: completa l’ordine dal checkout.',
  },
  order_too_large: {
    status: 400,
    error: 'Questo ordine è troppo grande per il riordino automatico: scrivici.',
  },
  destination_unknown: {
    status: 409,
    error: 'Non riusciamo a determinare la destinazione di questo ordine: scrivici e lo sistemiamo.',
  },
  quotation_required: {
    status: 409,
    error: 'Per questa destinazione calcoliamo la spedizione con lo sdoganamento incluso: scrivici e la quotiamo prima del pagamento.',
  },
}

export async function handleReorderRequest(orderId: string, accountEmail: string): Promise<NextResponse> {
  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
  const cmsSecret = process.env.PAYLOAD_API_SECRET
  if (!cmsUrl || !cmsSecret) {
    console.error('[account/reorder] configurazione CMS mancante')
    return NextResponse.json(
      { error: 'Sistema ordini temporaneamente non disponibile' },
      { status: 503 },
    )
  }

  // Questa lettura e' anche il preflight del CMS: usa la stessa credenziale con cui
  // il webhook scrivera' l'ordine, quindi se non passa non si apre nessun
  // pagamento. L'ordine deve appartenere all'email dell'account.
  let orderResponse: Response
  try {
    orderResponse = await fetch(
      `${cmsUrl}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderId)}`
      + `&where[customerEmail][equals]=${encodeURIComponent(accountEmail)}&depth=0&limit=1`,
      { headers: { 'x-storefront-secret': cmsSecret }, cache: 'no-store' },
    )
  } catch (err) {
    console.error('[account/reorder] CMS lookup failed:', err)
    return NextResponse.json(
      { error: 'Sistema ordini temporaneamente non disponibile' },
      { status: 503 },
    )
  }
  if (orderResponse.status === 404) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  }
  if (!orderResponse.ok) {
    console.error(`[account/reorder] CMS lookup rejected ${orderResponse.status}`)
    return NextResponse.json(
      { error: 'Sistema ordini temporaneamente non disponibile' },
      { status: 503 },
    )
  }

  const payload = await orderResponse.json().catch(() => null) as { docs?: unknown[] } | null
  const sourceOrder = payload?.docs?.[0]
  if (!sourceOrder) return NextResponse.json({ error: 'Order not found' }, { status: 404 })

  const result = buildReorderPlan({ order: sourceOrder, accountEmail, now: Date.now() })
  if (result.status === 'failed') {
    // Solo la ragione, mai dati del cliente.
    console.error(`[account/reorder] riordino non apribile (${result.reason})`)
    const failure = FAILURES[result.reason]
    return NextResponse.json({ error: failure.error }, { status: failure.status })
  }

  const storefrontUrl = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'
  try {
    const stripe = new Stripe(stripeSecret)
    const session = await stripe.checkout.sessions.create(
      buildReorderCheckoutSessionParams(result.plan, {
        successUrl: `${storefrontUrl}/account/ordini?reorder=success`,
        cancelUrl: `${storefrontUrl}/account`,
      }),
    )
    if (!session.url) {
      console.error('[account/reorder] sessione Stripe senza url')
      return NextResponse.json({ error: 'Pagamento temporaneamente non disponibile' }, { status: 502 })
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('[account/reorder] Stripe session creation failed:', err)
    return NextResponse.json({ error: 'Pagamento temporaneamente non disponibile' }, { status: 502 })
  }
}
