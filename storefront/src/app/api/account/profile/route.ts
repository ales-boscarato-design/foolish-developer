import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/account-auth'
import { updateSubscriberProfile } from '@/lib/account-db'

export async function PATCH(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['level', 'styles', 'locale', 'notify_orders', 'notify_new_batches', 'notify_offers']
  const data = Object.fromEntries(
    Object.entries(body).filter(([k]) => allowed.includes(k))
  )

  await updateSubscriberProfile(session.email, data)
  const res = NextResponse.json({ ok: true })
  if (typeof data.locale === 'string') {
    res.cookies.set('foolish_locale', data.locale, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax' })
  }
  return res
}
