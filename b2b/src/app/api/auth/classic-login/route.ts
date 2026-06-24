import { NextRequest, NextResponse } from 'next/server'
import { authenticateClassicLogin } from '@/lib/db'
import { createSessionToken, SESSION_COOKIE } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { email, businessName, phone } = await req.json()

  if (!email || !businessName || !phone) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 })
  }

  const member = await authenticateClassicLogin(email, businessName, phone)

  if (!member) {
    return NextResponse.json({ error: 'not_found' }, { status: 401 })
  }

  if (member.status !== 'active') {
    return NextResponse.json({ error: 'unauthorized' }, { status: 403 })
  }

  const sessionToken = await createSessionToken({
    email: member.email,
    businessName: member.business_name,
    contactName: member.contact_name,
    vatNumber: member.vat_number,
    status: member.status,
  })

  const res = NextResponse.json({ ok: true })
  res.cookies.set(SESSION_COOKIE.name, sessionToken, SESSION_COOKIE.options)
  return res
}
