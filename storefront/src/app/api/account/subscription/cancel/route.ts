import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSession } from '@/lib/account-auth'

export const dynamic = 'force-dynamic'

const CMS_URL = process.env.PAYLOAD_PUBLIC_URL || 'https://cms-production-1dda.up.railway.app'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const { subscriptionDocId } = (await req.json()) as { subscriptionDocId: string }
  if (!subscriptionDocId) return NextResponse.json({ error: 'ID mancante' }, { status: 400 })

  const docRes = await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    headers: { 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
  })
  if (!docRes.ok) return NextResponse.json({ error: 'Abbonamento non trovato' }, { status: 404 })
  const doc = await docRes.json()

  if (doc.customerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 403 })
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)
  await stripe.subscriptions.update(doc.stripeSubscriptionId, { cancel_at_period_end: true })

  await fetch(`${CMS_URL}/api/subscriptions/${subscriptionDocId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-storefront-secret': process.env.PAYLOAD_API_SECRET || '' },
    body: JSON.stringify({ status: 'canceling' }),
  })

  return NextResponse.json({ ok: true })
}
