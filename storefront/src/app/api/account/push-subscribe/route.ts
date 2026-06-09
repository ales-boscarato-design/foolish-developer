import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { savePushSubscription } from '@/lib/account-db'

export async function POST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subscription = await req.json()
  if (!subscription?.endpoint) {
    return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await savePushSubscription(session.email, subscription)
  return NextResponse.json({ ok: true })
}
