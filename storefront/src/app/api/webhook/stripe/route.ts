import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { upsertSubscriber, markCartSessionRecovered, logEmail, upsertCmsCustomer, enqueuePwaInvite } from '@/lib/marketing-db'
import { createCustomerOffer } from '@/lib/account-db'
import { sendWelcomeEmail, countryToLocale } from '@/lib/resend'
import { notifyNanobot } from '@/lib/nanobot'
import { attachScheduleToSubscription } from '@/lib/stripe-subscription-schedule'
import { getBenefitForCycle, type PlanKey, type Zone } from '@/lib/subscription-plans'

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
  const customerPhone = meta.customer_phone ?? ''
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
    headers: {
      'Content-Type': 'application/json',
      'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
    },
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'storefront',
      customerEmail,
      customerName,
      customerPhone: customerPhone || undefined,
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

const CMS_URL = () => process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'
const cmsHeaders = () => ({
  'Content-Type': 'application/json',
  'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '',
})

interface SubscriptionDoc {
  id: string
  customerEmail: string
  plan: PlanKey
  zone: Zone
  stripeSubscriptionId: string
  stripeScheduleId?: string
  status: 'active' | 'canceling' | 'canceled'
  cyclesCompleted: number
}

async function findSubscriptionByStripeId(stripeSubscriptionId: string): Promise<SubscriptionDoc | null> {
  const res = await fetch(
    `${CMS_URL()}/api/subscriptions?where[stripeSubscriptionId][equals]=${encodeURIComponent(stripeSubscriptionId)}&limit=1`,
    { headers: cmsHeaders() },
  )
  if (!res.ok) throw new Error(`CMS find subscription failed ${res.status}`)
  const data = await res.json()
  return data.docs?.[0] ?? null
}

async function createSubscriptionRecord(params: {
  customerEmail: string
  plan: PlanKey
  zone: Zone
  stripeSubscriptionId: string
  stripeScheduleId: string
}): Promise<SubscriptionDoc> {
  const res = await fetch(`${CMS_URL()}/api/subscriptions`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify({
      ...params,
      status: 'active',
      cyclesCompleted: 0,
      startedAt: new Date().toISOString(),
    }),
  })
  if (!res.ok) throw new Error(`CMS create subscription failed ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data.doc as SubscriptionDoc
}

async function updateSubscriptionRecord(id: string, patch: Record<string, unknown>): Promise<void> {
  const res = await fetch(`${CMS_URL()}/api/subscriptions/${id}`, {
    method: 'PATCH',
    headers: cmsHeaders(),
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(`CMS update subscription failed ${res.status}: ${await res.text()}`)
}

async function ensureScheduleAttached(
  stripe: Stripe,
  subscriptionId: string,
  plan: PlanKey,
  zone: Zone,
): Promise<string> {
  const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
  if (stripeSub.schedule) {
    return typeof stripeSub.schedule === 'string' ? stripeSub.schedule : stripeSub.schedule.id
  }
  const schedule = await attachScheduleToSubscription(stripe, subscriptionId, plan, zone)
  return schedule.id
}

const SUB_PLAN_NAMES: Record<PlanKey, string> = {
  tattoo: 'Abbonamento Tattoo XXL',
  pmu: 'Abbonamento PMU 3 Visi',
}

async function orderExists(orderRef: string): Promise<boolean> {
  const existing = await fetch(
    `${CMS_URL()}/api/orders?where[orderNumber][equals]=${encodeURIComponent(orderRef)}&limit=1`,
    { headers: cmsHeaders() },
  )
  if (!existing.ok) return false
  const data = await existing.json()
  return (data.docs?.length ?? 0) > 0
}

async function createRenewalOrder(params: {
  orderRef: string
  cycle: number
  plan: PlanKey
  zone: Zone
  customerEmail: string
  shippingAddress: { name: string; address1: string; address2: string; city: string; postalCode: string; country: string }
}): Promise<void> {
  const { orderRef, cycle, plan, zone, customerEmail, shippingAddress } = params
  const benefit = getBenefitForCycle(plan, zone, cycle)
  const lineItems = [
    { sku: `SUB-${plan.toUpperCase()}`, name: SUB_PLAN_NAMES[plan], variantLabel: `Ciclo ${cycle}`, quantity: 1, unitPrice: benefit.productPrice },
    ...(benefit.giftItem
      ? [{ sku: `SUB-${plan.toUpperCase()}-GIFT`, name: 'Omaggio abbonamento', variantLabel: '', quantity: 1, unitPrice: 0, isGift: true }]
      : []),
  ]

  const res = await fetch(`${CMS_URL()}/api/orders`, {
    method: 'POST',
    headers: cmsHeaders(),
    body: JSON.stringify({
      orderNumber: orderRef,
      source: 'subscription',
      customerEmail,
      customerName: shippingAddress.name,
      lineItems,
      total: benefit.total,
      shippingCost: benefit.shippingPrice,
      shippingAddress,
      pipelineState: 'received',
    }),
  })
  if (!res.ok) throw new Error(`CMS create renewal order failed ${res.status}: ${await res.text()}`)
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

    if (session.mode === 'subscription') {
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
      const meta = session.metadata ?? {}
      const plan = meta.plan as PlanKey | undefined
      const zone = meta.zone as Zone | undefined
      const customerEmail = (session.customer_email ?? session.customer_details?.email ?? meta.customerEmail ?? '').toLowerCase()

      if (subscriptionId && plan && zone && customerEmail) {
        try {
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
          const existing = await findSubscriptionByStripeId(subscriptionId)
          if (!existing) {
            const scheduleId = await ensureScheduleAttached(stripe, subscriptionId, plan, zone)
            await createSubscriptionRecord({
              customerEmail,
              plan,
              zone,
              stripeSubscriptionId: subscriptionId,
              stripeScheduleId: scheduleId,
            })
            console.log(`[webhook] Subscription schedule attached ${subscriptionId} (${plan}/${zone})`)
          } else if (!existing.stripeScheduleId) {
            // Race: invoice.payment_succeeded ha creato il record prima di questo
            // evento, senza schedule (nessuno step lo attacca in quel percorso).
            // Recuperiamo qui, altrimenti la scaletta a 3 fasi non parte mai.
            const scheduleId = await ensureScheduleAttached(stripe, subscriptionId, plan, zone)
            await updateSubscriptionRecord(existing.id, { stripeScheduleId: scheduleId })
            console.log(`[webhook] Subscription schedule attached late ${subscriptionId} (${plan}/${zone})`)
          }
        } catch (err) {
          console.error('[webhook] Subscription schedule attach failed:', err)
        }
      }
      return NextResponse.json({ received: true })
    }

    if (session.payment_status !== 'paid') {
      return NextResponse.json({ received: true })
    }

    const orderRef = session.metadata?.order_ref ?? `FOOLISH-${session.id}`
    const customerEmail = session.customer_email ?? session.customer_details?.email ?? ''
    const total = ((session.amount_total ?? 0) / 100).toFixed(2)
    console.log(`[webhook] ORDER RECEIVED ${orderRef} | ${customerEmail} | €${total}`)

    // Crea ordine in Payload CMS — retry automatico fino a 4 tentativi
    let cmsError: string | null = null
    try {
      await createOrderInCMSWithRetry(session)
      console.log(`[webhook] CMS order created OK ${orderRef}`)
    } catch (err) {
      cmsError = err instanceof Error ? err.message : String(err)
      console.error(`[webhook] CMS order FAILED ${orderRef}:`, cmsError)
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

    // Offerta post-ordine — fetch config CMS e crea offerta per il cliente
    try {
      const cmsUrl = process.env.NEXT_PUBLIC_CMS_URL ?? process.env.PAYLOAD_PUBLIC_URL
      const cmsSecret = process.env.PAYLOAD_API_SECRET
      if (cmsUrl && cmsSecret) {
        const offerRes = await fetch(
          `${cmsUrl}/api/offer-config?where[active][equals]=true&depth=1&limit=1`,
          { headers: { 'x-storefront-secret': cmsSecret }, cache: 'no-store' }
        )
        if (offerRes.ok) {
          const offerData = await offerRes.json() as {
            docs?: Array<{ product?: { slug?: string }; threshold: number; discountBelow: number; discountAbove: number; validityHours: number }>
          }
          const config = offerData.docs?.[0]
          const productSlug = config?.product?.slug
          if (config && productSlug) {
            const orderTotal = (session.amount_total ?? 0) / 100
            const discount = orderTotal < config.threshold ? config.discountBelow : config.discountAbove
            const email = (session.customer_email ?? session.customer_details?.email ?? '').toLowerCase()
            if (email) {
              await createCustomerOffer(email, orderRef, productSlug, discount, config.validityHours)
              console.log(`[webhook] Offer created for ${email}: ${discount}% on ${productSlug}`)
            }
          }
        }
      }
    } catch (err) {
      console.error('[webhook] Offer creation failed:', err)
    }

    // Notifica nanobot — sempre, con flag cmsError esplicito
    await notifyNanobot('/hooks/foolish-storefront-order', {
      source: 'storefront',
      stripeSessionId: session.id,
      externalRef: session.metadata?.order_ref,
      amount: (session.amount_total ?? 0) / 100,
      currency: session.currency?.toUpperCase(),
      customerEmail: session.customer_email,
      customerName: session.metadata?.customer_name,
      itemsJson: session.metadata?.items_json,
      cmsError,
    })

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

        // Enqueue PWA invite email — sent 15 min later (every order, idempotent after first)
        await enqueuePwaInvite({
          email: mktEmail,
          name: customerName,
          locale,
          subscriberId,
        })
      } catch (err) {
        // Marketing errors must never block Stripe response
        console.error('Marketing upsert/welcome failed:', err)
      }
    }
  }

  if (event.type === 'invoice.payment_succeeded') {
    const invoice = event.data.object
    // Stripe v22 non espone più `invoice.subscription` a livello root: l'id sta
    // dentro `parent.subscription_details.subscription` (verificato in
    // node_modules/stripe/cjs/resources/Invoices.d.ts).
    const subscriptionDetails = invoice.parent?.subscription_details
    const subscriptionId = subscriptionDetails
      ? typeof subscriptionDetails.subscription === 'string'
        ? subscriptionDetails.subscription
        : subscriptionDetails.subscription.id
      : undefined

    if (subscriptionId) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
        let record = await findSubscriptionByStripeId(subscriptionId)

        if (!record) {
          // L'invoice del primo ciclo può arrivare prima del checkout.session.completed:
          // ricostruiamo il record dalla subscription Stripe (ha i metadata impostati da subscription_data.metadata).
          const stripeSub = await stripe.subscriptions.retrieve(subscriptionId)
          const plan = stripeSub.metadata.plan as PlanKey
          const zone = stripeSub.metadata.zone as Zone
          const customerEmail = (stripeSub.metadata.customerEmail || '').toLowerCase()
          if (!plan || !zone || !customerEmail) throw new Error(`Subscription ${subscriptionId} senza metadata plan/zone/email`)
          // L'invoice può arrivare prima del checkout.session.completed: se
          // così, questo è il primo evento a toccare la subscription, quindi
          // tocca a noi attaccare lo schedule (altrimenti resta senza per
          // sempre, dato che il ramo checkout.session.completed troverà
          // `existing` già presente e non ci riproverebbe se non fosse per
          // il controllo su stripeScheduleId vuoto qui sotto).
          const scheduleId = await ensureScheduleAttached(stripe, subscriptionId, plan, zone)
          record = await createSubscriptionRecord({
            customerEmail,
            plan,
            zone,
            stripeSubscriptionId: subscriptionId,
            stripeScheduleId: scheduleId,
          })
        }

        // Idempotenza sull'invoice reale (stabile ad ogni redelivery Stripe dello
        // stesso evento), non sul contatore cyclesCompleted (mutabile — vedi nota
        // di correzione sopra).
        const orderRef = `FOOLISH-SUB-${subscriptionId}-${invoice.id}`
        if (await orderExists(orderRef)) {
          console.log(`[webhook] Invoice ${invoice.id} già processata, skip`)
          return NextResponse.json({ received: true })
        }

        const newCycle = record.cyclesCompleted + 1
        const shippingDetails = invoice.customer_shipping
        const shippingAddress = {
          name: shippingDetails?.name ?? '',
          address1: shippingDetails?.address?.line1 ?? '',
          address2: shippingDetails?.address?.line2 ?? '',
          city: shippingDetails?.address?.city ?? '',
          postalCode: shippingDetails?.address?.postal_code ?? '',
          country: shippingDetails?.address?.country ?? record.zone,
        }

        await createRenewalOrder({
          orderRef,
          cycle: newCycle,
          plan: record.plan,
          zone: record.zone,
          customerEmail: record.customerEmail,
          shippingAddress,
        })
        // Il contatore avanza SOLO dopo la creazione riuscita dell'ordine, dietro
        // lo stesso controllo di idempotenza sopra: un redelivery dello stesso
        // invoice trova l'ordine già esistente e non fa avanzare il contatore
        // una seconda volta (altrimenti: doppio ordine con ciclo sbagliato, o
        // ciclo saltato per sempre se la creazione fallisce dopo l'incremento).
        await updateSubscriptionRecord(record.id, { cyclesCompleted: newCycle })
        console.log(`[webhook] Renewal order created for ${subscriptionId}, cycle ${newCycle}`)
      } catch (err) {
        console.error('[webhook] invoice.payment_succeeded handling failed:', err)
      }
    }
    return NextResponse.json({ received: true })
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object
    try {
      const record = await findSubscriptionByStripeId(subscription.id)
      if (record) {
        await updateSubscriptionRecord(record.id, { status: 'canceled', canceledAt: new Date().toISOString() })
        console.log(`[webhook] Subscription ${subscription.id} marked canceled`)
      }
    } catch (err) {
      console.error('[webhook] customer.subscription.deleted handling failed:', err)
    }
    return NextResponse.json({ received: true })
  }

  return NextResponse.json({ received: true })
}
