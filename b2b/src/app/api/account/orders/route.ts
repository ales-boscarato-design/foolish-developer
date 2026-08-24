import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { findB2BOrdersByEmail } from '@/lib/cms-orders'

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const cmsOrders = await findB2BOrdersByEmail(session.email)
  const orders = cmsOrders.map(order => ({
    id: order.id,
    order_number: order.orderNumber,
    total: order.total ?? 0,
    pipeline_state: order.pipelineState ?? 'received',
    created_at: order.createdAt ?? new Date(0).toISOString(),
    tracking_number: order.trackingNumber ?? null,
  }))

  return NextResponse.json({ session, orders })
}
