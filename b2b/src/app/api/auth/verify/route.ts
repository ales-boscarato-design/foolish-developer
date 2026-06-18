import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { findProMemberByEmail } from '@/lib/db'

export async function GET(req: NextRequest) {
  const baseUrl = process.env.NEXT_PUBLIC_URL ?? 'https://rivenditori.thefoolishbutcher.com'
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid', baseUrl))
  }

  const email = await verifyMagicToken(token)
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=expired', baseUrl))
  }

  const member = await findProMemberByEmail(email)
  if (!member || member.status !== 'active') {
    return NextResponse.redirect(new URL('/login?error=unauthorized', baseUrl))
  }

  const sessionToken = await createSessionToken({
    proMemberId: member.id,
    email: member.email,
    businessName: member.business_name,
    contactName: member.contact_name,
    vatNumber: member.vat_number,
    status: member.status,
  })

  const res = NextResponse.redirect(new URL('/catalogo', baseUrl))
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
