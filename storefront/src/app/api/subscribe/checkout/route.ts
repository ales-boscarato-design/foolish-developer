import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { SUBSCRIPTION_LADDER, ZONE_COUNTRIES, PLAN_NAMES, type PlanKey, type Zone } from '@/lib/subscription-plans'

export const dynamic = 'force-dynamic'

const STOREFRONT_URL = process.env.STOREFRONT_URL || 'https://thefoolishbutcher.com'

interface Body {
  plan: PlanKey
  zone: Zone
  email: string
  locale: string
}

// Stripe v22's declaration-merged `Stripe.Checkout.SessionCreateParams` namespace
// doesn't resolve nested members (e.g. `.ShippingAddressCollection.AllowedCountry`)
// through this package's re-exports under this project's tsconfig (moduleResolution:
// bundler) — verified against node_modules/stripe/cjs/resources/Checkout/Sessions.d.ts.
// Indexed-access types on the interface sidestep the broken qualified-name lookup.
type AllowedCountry = NonNullable<
  Stripe.Checkout.SessionCreateParams['shipping_address_collection']
>['allowed_countries'][number]

export async function POST(req: NextRequest) {
  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })
  }

  const { plan, zone, email, locale } = (await req.json()) as Body

  if (!SUBSCRIPTION_LADDER[plan]?.[zone] || !email) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const firstPhase = SUBSCRIPTION_LADDER[plan][zone].phases[0]
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer_email: email,
    billing_address_collection: 'auto',
    shipping_address_collection: {
      allowed_countries: ZONE_COUNTRIES[zone] as AllowedCountry[],
    },
    line_items: [
      {
        price_data: {
          currency: 'eur',
          recurring: { interval: 'month' },
          unit_amount: Math.round((firstPhase.productPrice + firstPhase.shippingPrice) * 100),
          product_data: { name: `${PLAN_NAMES[plan]} — ${zone}` },
        },
        quantity: 1,
      },
    ],
    subscription_data: {
      metadata: { plan, zone, customerEmail: email, locale },
    },
    success_url: `${STOREFRONT_URL}/${locale}/abbonamento/${plan}?subscribed=1`,
    cancel_url: `${STOREFRONT_URL}/${locale}/abbonamento/${plan}`,
  })

  return NextResponse.json({ checkoutUrl: session.url })
}
