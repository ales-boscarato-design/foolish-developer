import { NextRequest, NextResponse } from 'next/server'
import { verifyMagicToken, createSessionToken, SESSION_COOKIE } from '@/lib/auth'
import { findProMemberByEmail } from '@/lib/db'

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.redirect(new URL('/login?error=invalid', req.url))
  }

  const email = await verifyMagicToken(token)
  if (!email) {
    return NextResponse.redirect(new URL('/login?error=expired', req.url))
  }

  const member = await findProMemberByEmail(email)
  if (!member || member.status !== 'active') {
    return NextResponse.redirect(new URL('/login?error=unauthorized', req.url))
  }

  const sessionToken = await createSessionToken({
    proMemberId: member.id,
    email: member.email,
    businessName: member.business_name,
    contactName: member.contact_name,
    vatNumber: member.vat_number,
    status: member.status,
  })

  const res = NextResponse.redirect(new URL('/catalogo', req.url))
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
