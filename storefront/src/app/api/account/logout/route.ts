import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { getSession, SESSION_COOKIE } from '@/lib/account-auth'
import { clearPushSubscription } from '@/lib/account-db'
import { performLogout } from '@/lib/logout-session'

export async function POST() {
  const result = await performLogout({
    getSession,
    clearPushSubscription,
    deleteSessionCookie: async () => { (await cookies()).delete(SESSION_COOKIE.name) },
    onError: (err) => { console.error('logout: push_subscription non azzerata:', err instanceof Error ? err.message : 'errore') },
  })
  return NextResponse.json({ ok: result.ok })
}
