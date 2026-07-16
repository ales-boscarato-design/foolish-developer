import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSession } from '@/lib/account-auth'
import { rebuildRemainingPhases } from '@/lib/stripe-subscription-schedule'
import type { Zone } from '@/lib/subscription-plans'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { subscriptionDocId, newZone } = (await req.json()) as { subscriptionDocId: string; newZone: Zone }
  if (!subscriptionDocId || (newZone !== 'IT' && newZone !== 'EU')) {
    return NextResponse.json({ error: 'Parametri non validi' }, { status: 400 })
  }

  const docRes = await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
  })
  if (!docRes.ok) return NextResponse.json({ error: 'Abbonamento non trovato' }, { status: 404 })
  const doc = await docRes.json()

  if (doc.customerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }
  if (doc.zone === newZone) {
    return NextResponse.json({ ok: true }) // nessun cambiamento
  }
  if (!doc.stripeScheduleId) {
    return NextResponse.json({ error: 'Abbonamento senza schedule Stripe' }, { status: 400 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  await rebuildRemainingPhases(stripe, doc.stripeScheduleId, doc.plan, newZone, doc.cyclesCompleted)

  const patchRes = await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
    body: JSON.stringify({ zone: newZone }),
  })
  if (!patchRes.ok) return NextResponse.json({ error: 'Errore aggiornamento abbonamento' }, { status: 500 })

  return NextResponse.json({ ok: true })
}
