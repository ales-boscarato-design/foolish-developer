import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { upsertSubscriber, markCartSessionRecovered, logEmail, upsertCmsCustomer } from '@/lib/marketing-db'
import { sendWelcomeEmail, countryToLocale } from '@/lib/resend'

export const dynamic = 'force-dynamic'

interface ParsedItem {
  sku: string
  qty: number
  name: string
  variantLabel: string
  price: number
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function createOrderInCMSWithRetry(session: Stripe.Checkout.Session): Promise<void> {
  const delays = [0, 2000, 5000, 10000] // 4 tentativi: subito, 2s, 5s, 10s
  let lastError: Error | null = null
  for (const delay of delays) {
    if (delay > 0) await sleep(delay)
    try {
      await createOrderInCMS(session)
      return // successo
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      console.error(`CMS order creation attempt failed (retry in ${delay}ms):`, lastError.message)
    }
  }
  throw lastError
}

async function createOrderInCMS(session: Stripe.Checkout.Session): Promise<void> {
  const cmsUrl = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

  const meta = session.metadata ?? {}
  const orderRef = meta.order_ref ?? `FOOLISH-${session.id}`
  const customerName = meta.customer_name ?? session.customer_details?.name ?? ''
  const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
  const total = (session.amount_total ?? 0) / 100

  let parsedItems: ParsedItem[] = []
  try {
    parsedItems = JSON.parse(meta.items_json ?? '[]')
  } catch {
    // items_json malformato — ordine viene creato comunque
  }

  const itemsTotal = parsedItems.reduce((sum, i) => sum + i.price * i.qty, 0)
  const shippingCost = Math.max(0, parseFloat((total - itemsTotal).toFixed(2)))

  // Indirizzo da Stripe shipping_details (raccolto da Stripe checkout form)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const shipping = (session as any).shipping_details as {
    address?: { line1?: string; line2?: string; city?: string; postal_code?: string; country?: string }
  } | null
  const shippingAddress = shipping
    ? {
        name: shipping.address ? customerName : '',
        address1: shipping.address?.line1 ?? '',
        address2: shipping.address?.line2 ?? '',
        city: shipping.address?.city ?? '',
        postalCode: shipping.address?.postal_code ?? '',
        country: shipping.address?.country ?? '',
      }
    : (() => {
        // fallback: parsing dal metadata customer_address (address|city|postalCode)
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

  const lineItems = parsedItems.map((i) => ({
    sku: i.sku,
    name: i.name,
    variantLabel: i.variantLabel,
    quantity: i.qty,
    unitPrice: i.price,
  }))

  // Check if order already exists (Stripe may retry webhooks)
  const existing = await fetch(
    `${cmsUrl}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&limit=1`,
    { headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' } },
  )
  if (existing.ok) {
    const existingData = await existing.json()
    if (existingData.docs?.length > 0) return // already created, idempotent
  }

  const customerLocale = countryToLocale(shippingAddress?.country)

  const res = await fetch(`${cmsUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'storefront',
      customerEmail,
      customerName,
      lineItems,
      total,
      shippingCost,
      shippingAddress,
      customerLocale,
      pipelineState: 'received',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`CMS create order failed ${res.status}: ${text}`)
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    console.error('STRIPE_WEBHOOK_SECRET non configurato')
    return NextResponse.json({ error: 'Config error' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('stripe-signature') ?? ''

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (err) {
    console.error('Stripe webhook signature invalid:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object
    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    // Crea ordine in Payload CMS — retry automatico fino a 4 tentativi
    let cmsError: string | null = null
    try {
      await createOrderInCMSWithRetry(session)
    } catch (err) {
      cmsError = err instanceof Error ? err.message : String(err)
      console.error('CMS order creation FAILED after all retries:', cmsError)
    }

    // Upsert cliente in Payload CMS customers
    try {
      const customerEmail = (session.customer_email ?? session.customer_details?.email ?? '').toLowerCase().trim()
      const customerName = session.metadata?.customer_name ?? session.customer_details?.name ?? null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const country = (session as any).shipping_details?.address?.country ?? session.metadata?.customer_country ?? null
      if (customerEmail) {
        await upsertCmsCustomer({ email: customerEmail, name: customerName, country })
      }
    } catch (err) {
      console.error('CMS customer upsert failed:', err)
    }

    // Notifica nanobot — sempre, con flag cmsError esplicito
    const nanobotUrl = process.env.NANOBOT_WEBHOOK_URL
    if (nanobotUrl) {
      await fetch(`${nanobotUrl}/hooks/foolish-storefront-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'storefront',
          stripeSessionId: session.id,
          externalRef: session.metadata?.order_ref,
          amount: (session.amount_total ?? 0) / 100,
          currency: session.currency?.toUpperCase(),
          customerEmail: session.customer_email,
          customerName: session.metadata?.customer_name,
          itemsJson: session.metadata?.items_json,
          cmsError,
        }),
      }).catch((e) => console.error('nanobot notify failed:', e))
    }

    // Marketing: upsert subscriber + welcome email on first purchase
    const mktEmail = (session.customer_email ?? session.customer_details?.email)?.toLowerCase().trim() ?? null
    if (mktEmail) {
      try {
        const customerName = session.metadata?.customer_name ?? session.customer_details?.name ?? null
        const amountEur = (session.amount_total ?? 0) / 100
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const shippingCountry = (session as any).shipping_details?.address?.country
          ?? session.metadata?.customer_country
          ?? null
        const locale = countryToLocale(shippingCountry)

        const { id: subscriberId, isNew } = await upsertSubscriber({
          email: mktEmail,
          name: customerName,
          locale,
          amountEur,
        })

        // Mark any open cart session as recovered (purchase completed)
        await markCartSessionRecovered(mktEmail)

        // Welcome email only on first purchase
        if (isNew) {
          const resendId = await sendWelcomeEmail({
            to: mktEmail,
            name: customerName,
            locale,
            subscriberId,
          })
          await logEmail({
            email: mktEmail,
            type: 'welcome',
            resendId,
            subscriberId,
          })
        }
      } catch (err) {
        // Marketing errors must never block Stripe response
        console.error('Marketing upsert/welcome failed:', err)
      }
    }
  }

  return NextResponse.json({ received: true })
}
