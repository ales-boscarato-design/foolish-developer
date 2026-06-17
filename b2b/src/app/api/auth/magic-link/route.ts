import { NextRequest, NextResponse } from 'next/server'
import { findProMemberByEmail } from '@/lib/db'
import { createMagicToken } from '@/lib/auth'
import { sendMagicLink } from '@/lib/resend'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email richiesta' }, { status: 400 })
  }

  const member = await findProMemberByEmail(email.toLowerCase().trim())

  // Risposta identica sia per email trovate che non (sicurezza)
  if (!member || member.status !== 'active') {
    return NextResponse.json({ ok: true })
  }

  const token = await createMagicToken(email.toLowerCase().trim())
  const baseUrl = process.env.NEXT_PUBLIC_URL ?? 'https://rivenditori.thefoolishbutcher.com'
  const link = `${baseUrl}/auth/verify?token=${token}`

  await sendMagicLink(email, link, member.contact_name)

  return NextResponse.json({ ok: true })
}
