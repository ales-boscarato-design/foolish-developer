import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSession } from '@/lib/account-auth'
import { changeSubscriptionZone } from '@/lib/subscription-zone-change'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1e56.up.railway.app'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) return NextResponse.json({ error: 'Stripe non configurato' }, { status: 503 })

  let payload: { subscriptionDocId?: unknown; newZone?: unknown }
  try {
    payload = (await req.json()) as { subscriptionDocId?: unknown; newZone?: unknown }
  } catch {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  // La destinazione dell'abbonamento vive su Stripe (fattura/cliente), non nel CMS,
  // e il cambio di zona non si autorizza senza sapere dove spediamo: il nucleo la
  // legge e applica la policy (`isZoneChangeAllowed`).
  const result = await changeSubscriptionZone(
    {
      stripe: new Stripe(stripeSecret),
      cmsUrl: CMS_URL,
      cmsSecret: process.env.PAYLOAD_API_SECRET || '',
    },
    {
      subscriptionDocId: payload?.subscriptionDocId,
      newZone: payload?.newZone,
      sessionEmail: session.email,
    },
  )

  return NextResponse.json(result.body, { status: result.status })
}
