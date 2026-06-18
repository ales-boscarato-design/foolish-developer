import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { verifySessionToken, SESSION_COOKIE } from '@/lib/auth'
import { getResellerOrders } from '@/lib/db'

export async function GET(_req: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get(SESSION_COOKIE.name)?.value
  if (!token) return NextResponse.json({ error: 'Non autenticato' }, { status: 401 })

  const session = await verifySessionToken(token)
  if (!session) return NextResponse.json({ error: 'Sessione scaduta' }, { status: 401 })

  const orders = await getResellerOrders(session.email)

  return NextResponse.json({ session, orders })
}
