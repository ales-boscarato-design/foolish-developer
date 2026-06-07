import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const secret = req.headers.get('x-storefront-secret')
  if (!secret || secret !== process.env.PAYLOAD_API_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [cartsToday, cartsAbandoned, ordersToday, ordersWeek] = await Promise.all([
    // Carrelli attivi: avviati oggi, non recuperati
    sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM marketing.cart_sessions
      WHERE DATE(checkout_started_at AT TIME ZONE 'Europe/Rome') = CURRENT_DATE
        AND recovered_at IS NULL
    `,
    // Carrelli abbandonati: avviati >1h fa, non recuperati, ultimi 7 giorni
    sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM marketing.cart_sessions
      WHERE checkout_started_at <= NOW() - INTERVAL '1 hour'
        AND recovered_at IS NULL
        AND checkout_started_at >= NOW() - INTERVAL '7 days'
    `,
    // Ordini completati oggi
    sql<[{ count: string }]>`
      SELECT COUNT(*)::text AS count
      FROM public.orders
      WHERE DATE(created_at AT TIME ZONE 'Europe/Rome') = CURRENT_DATE
    `,
    // Ordini completati ultimi 7 giorni
    sql<[{ count: string; total: string }]>`
      SELECT COUNT(*)::text AS count, COALESCE(SUM(total), 0)::text AS total
      FROM public.orders
      WHERE created_at >= NOW() - INTERVAL '7 days'
    `,
  ])

  return NextResponse.json({
    carts_active_today: parseInt(cartsToday[0].count),
    carts_abandoned_7d: parseInt(cartsAbandoned[0].count),
    orders_today: parseInt(ordersToday[0].count),
    orders_7d: parseInt(ordersWeek[0].count),
    revenue_7d: parseFloat(ordersWeek[0].total),
  })
}
