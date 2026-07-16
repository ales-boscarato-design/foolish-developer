import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

export const dynamic = 'force-dynamic'

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

async function findPrintfulVariantForSku(sku: string): Promise<string | null> {
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
  const res = await fetch(
    `${cmsUrl}/api/products?where[section][equals]=merch&where[variants.sku][equals]=${encodeURIComponent(sku)}&depth=0&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' } },
  )
  if (!res.ok) return null
  const data = await res.json()
  const product = data.docs?.[0] as { variants?: Array<{ sku: string; printfulSyncVariantId?: string }> } | undefined
  const variant = product?.variants?.find((v) => v.sku === sku)
  return variant?.printfulSyncVariantId ?? null
}

function printfulHeaders(): Record<string, string> {
  const apiKey = process.env.PRINTFUL_API_KEY
  if (!apiKey) throw new Error('PRINTFUL_API_KEY non configurata')
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
}

// Idempotenza: la documentazione pubblica Printful NON garantisce che un secondo
// POST /orders con lo stesso external_id venga deduplicato (potrebbe rifiutarlo
// con errore, oppure — non essendo questo comportamento documentato in modo
// esplicito — nel peggiore dei casi crearne uno nuovo). Un ordine di stampa
// duplicato è un costo reale e non recuperabile automaticamente (a differenza di
// un webhook CMS duplicato, che è un no-op idempotente), quindi qui NON ci
// affidiamo silenziosamente a external_id: verifichiamo esplicitamente presso
// Printful stesso se un ordine con questo external_id esiste già PRIMA di crearne
// uno nuovo (GET /orders/@{external_id} — Printful supporta il prefisso "@" per
// riferirsi a risorse tramite external_id, come documentato per Sync
// Product/Variant). Come ulteriore rete di sicurezza contro la finestra di razza
// check-then-create in caso di redelivery Stripe concorrenti, trattiamo anche un
// eventuale errore di "external_id duplicato" ritornato dalla create come segnale
// di "già fulfillato" invece che come fallimento.
async function printfulOrderAlreadyExists(orderRef: string): Promise<boolean> {
  const res = await fetch(`https://api.printful.com/orders/@${encodeURIComponent(orderRef)}`, {
    method: 'GET',
    headers: printfulHeaders(),
  })
  if (res.status === 404) return false
  if (res.ok) return true
  const text = await res.text()
  throw new Error(`Printful lookup order failed ${res.status}: ${text}`)
}

async function createPrintfulOrder(params: {
  orderRef: string
  items: Array<{ variantId: string; quantity: number }>
  shipping: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const res = await fetch('https://api.printful.com/orders', {
    method: 'POST',
    headers: printfulHeaders(),
    body: JSON.stringify({
      external_id: params.orderRef,
      recipient: {
        name: params.shipping.name,
        address1: params.shipping.address1,
        address2: params.shipping.address2 || undefined,
        city: params.shipping.city,
        zip: params.shipping.postalCode,
        country_code: params.shipping.country,
      },
      items: params.items.map((i) => ({ sync_variant_id: Number(i.variantId), quantity: i.quantity })),
      confirm: true,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    // Rete di sicurezza: se Printful segnala che l'external_id è già in uso,
    // trattiamo la richiesta come già evasa (non un errore) — vedi nota di
    // idempotenza sopra sulla finestra di razza check-then-create.
    if (res.status === 409 || /external_id/i.test(text)) {
      console.warn(`[printful-webhook] Ordine ${params.orderRef} risulta già presente su Printful (create ha risposto ${res.status}): ${text}`)
      return
    }
    throw new Error(`Printful create order failed ${res.status}: ${text}`)
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_PRINTFUL_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_PRINTFUL_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('Printful fulfillment webhook signature invalid:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object

    // Le sessioni abbonamento non hanno righe merch (metadata plan/zone, non
    // items_json) — le escludiamo esplicitamente per chiarezza, stesso
    // controllo fatto per primo nel webhook principale.
    if (session.mode === 'subscription') {
      return NextResponse.json({ received: true })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    try {
      const meta = session.metadata ?? {}
      const orderRef = meta.order_ref ?? `FOOLISH-${session.id}`

      let parsedItems: ParsedItem[] = []
      try {
        parsedItems = JSON.parse(meta.items_json ?? '[]')
      } catch {
        return NextResponse.json({ received: true })
      }

      const merchItems: Array<{ variantId: string; quantity: number }> = []
      for (const item of parsedItems) {
        const variantId = await findPrintfulVariantForSku(item.sku)
        if (variantId) merchItems.push({ variantId, quantity: item.qty })
      }

      if (merchItems.length === 0) {
        return NextResponse.json({ received: true }) // nessuna riga merch in questo ordine
      }

      if (await printfulOrderAlreadyExists(orderRef)) {
        console.log(`[printful-webhook] Ordine Printful già esistente per ${orderRef}, skip (redelivery Stripe)`)
        return NextResponse.json({ received: true })
      }

      const customerName = meta.customer_name ?? session.customer_details?.name ?? ''

      // Stesso pattern di cast già usato nel webhook Stripe principale per lo
      // stesso identico campo (session.shipping_details non è ancora tipizzato
      // nelle @types di questa versione della SDK Stripe).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const shippingDetails = (session as any).shipping_details as {
        address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string }
      } | null

      const shipping = shippingDetails?.address
        ? {
            name: customerName,
            address1: shippingDetails.address.line1 ?? '',
            address2: shippingDetails.address.line2 ?? '',
            city: shippingDetails.address.city ?? '',
            postalCode: shippingDetails.address.postal_code ?? '',
            country: shippingDetails.address.country ?? '',
          }
        : (() => {
            // fallback: parsing dal metadata customer_address (address|city|postalCode),
            // stesso fallback usato nel webhook principale per checkout senza
            // raccolta nativa Stripe dell'indirizzo di spedizione.
            const parts = (meta.customer_address ?? '').split('|')
            return {
              name: customerName,
              address1: parts[0] ?? '',
              address2: '',
              city: parts[1] ?? '',
              postalCode: parts[2] ?? '',
              country: meta.customer_country ?? '',
            }
          })()

      await createPrintfulOrder({ orderRef, items: merchItems, shipping })
      console.log(`[printful-webhook] Ordine Printful creato per ${orderRef} (${merchItems.length} righe)`)
    } catch (err) {
      console.error('[printful-webhook] Fulfillment failed:', err)
    }
  }

  return NextResponse.json({ received: true })
}
