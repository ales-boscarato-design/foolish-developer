import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { notifyStripeReconciliation } from '@/lib/stripe-reconciliation-alert'
import { reconcilePaidStripeOrders } from '@/lib/stripe-orders'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!process.env.STRIPE_SECRET_KEY || !process.env.PAYLOAD_API_SECRET) {
    return NextResponse.json({ error: 'Stripe or CMS not configured' }, { status: 500 })
  }

  const requestedDays = req.nextUrl.searchParams.get('days')
  const configuredDays = Number.parseInt(
    requestedDays ?? process.env.STRIPE_RECONCILE_LOOKBACK_DAYS ?? '30',
    10,
  )
  const lookbackDays = Number.isFinite(configuredDays) && configuredDays > 0
    ? Math.min(configuredDays, 365)
    : 30
  const heartbeat = req.nextUrl.searchParams.get('heartbeat') === '1'

  try {
    const result = await reconcilePaidStripeOrders({
      stripe: new Stripe(process.env.STRIPE_SECRET_KEY),
      lookbackDays,
    })

    console.log('[stripe-reconcile]', JSON.stringify(result))

    if (heartbeat || result.recovered.length > 0 || result.errors.length > 0) {
      await notifyStripeReconciliation({
        eventType: heartbeat
          ? 'stripe_order_reconciliation_heartbeat'
          : 'stripe_order_reconciliation',
        result,
      })
    }

    if (result.errors.length > 0) {
      return NextResponse.json({ ok: false, ...result }, { status: 500 })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error('[stripe-reconcile] fatal:', message)
    await notifyStripeReconciliation({
      eventType: 'stripe_order_reconciliation_fatal',
      error: message,
    }).catch((notificationError) => {
      console.error('[stripe-reconcile] fatal alert failed:', notificationError)
    })
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
