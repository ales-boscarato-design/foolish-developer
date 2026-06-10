import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/account-auth'

export async function GET(req: NextRequest) {
  const base = process.env.STOREFRONT_URL ?? `https://${req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? 'localhost'}`
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(`${base}/account/login?error=missing`)

  const payload = await verifyMagicToken(token)
  if (!payload) return NextResponse.redirect(`${base}/account/login?error=expired`)

  const sessionToken = await createSessionToken(payload.email)
  const res = NextResponse.redirect(`${base}/account`)
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
