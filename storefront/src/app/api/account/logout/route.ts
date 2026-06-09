import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/account-auth'
import { cookies } from 'next/headers'

export async function POST() {
  const cookieStore = await cookies()
  cookieStore.delete(SESSION_COOKIE.name)
  return NextResponse.json({ ok: true })
}
