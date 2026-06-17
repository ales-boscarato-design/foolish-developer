import { NextResponse } from 'next/server'
import { sendWelcomeEmail } from '@/lib/resend'

export async function GET() {
  try {
    await sendWelcomeEmail({
      email: 'boscaratoa@icloud.com',
      name: 'Alessandro',
      locale: 'it',
      token: 'test-unsubscribe-token',
    })
    return NextResponse.json({ ok: true, message: 'Welcome email inviata' })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}
