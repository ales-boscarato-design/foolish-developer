import { NextResponse } from 'next/server'
import { SESSION_COOKIE } from '@/lib/auth'

export async function GET() {
  const res = NextResponse.redirect(
    new URL('/login', process.env.NEXT_PUBLIC_URL ?? 'https://rivenditori.thefoolishbutcher.com')
  )
  res.cookies.delete(SESSION_COOKIE.name)
  return res
}
