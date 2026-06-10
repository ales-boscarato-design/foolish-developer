import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/account-auth'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/account/login?error=missing', req.url))

  const payload = await verifyMagicToken(token)
  if (!payload) return NextResponse.redirect(new URL('/account/login?error=expired', req.url))

  const sessionToken = await createSessionToken(payload.email)
  const res = NextResponse.redirect(new URL('/account', req.url))
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
